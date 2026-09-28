import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { accountTypes, isValidRegistrationOption } from "../config/registration-options.js";

const publicUser = (user) => {
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
};

export async function registerUser(input) {
  const name = String(input.name || "").trim();
  const phone = String(input.phone || "").trim();
  const email = String(input.email || "").trim().toLowerCase();
  const password = String(input.password || "");
  const supervisor = String(input.supervisor || "").trim();
  const accountType = String(input.accountType || "").trim().toUpperCase();
  const registrationOptions = await getRegistrationOptions();

  if (!name || !phone || !email || !password || !accountType) {
    const error = new Error("name, phone, email, password, and accountType are required.");
    error.statusCode = 400;
    throw error;
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    const error = new Error("Enter a valid email address.");
    error.statusCode = 400;
    throw error;
  }
  if (password.length < 8) {
    const error = new Error("Password must be at least 8 characters.");
    error.statusCode = 400;
    throw error;
  }
  if (accountType === "EMPLOYEE" && !isValidRegistrationOption(registrationOptions.supervisors, supervisor)) {
    const error = new Error("Select a valid supervisor.");
    error.statusCode = 400;
    throw error;
  }
  if (accountType !== "EMPLOYEE" && supervisor) {
    const error = new Error("Only employee accounts can have a supervisor.");
    error.statusCode = 400;
    throw error;
  }
  if (!isValidRegistrationOption(registrationOptions.accountTypes, accountType)) {
    const error = new Error("Select a valid work account type.");
    error.statusCode = 400;
    throw error;
  }

  const existingUser = await prisma.user.findUnique({ where: { email } });
  if (existingUser) {
    const error = new Error("An account with this email already exists.");
    error.statusCode = 409;
    throw error;
  }

  const supabaseAdmin = getSupabaseAdmin();
  let supabaseUser;

  if (supabaseAdmin) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: false,
      user_metadata: { name, phone, supervisor: accountType === "EMPLOYEE" ? supervisor : null, accountType },
    });
    if (error) {
      const authError = new Error(error.message);
      authError.statusCode = error.status || 400;
      throw authError;
    }
    supabaseUser = data.user;
  }

  try {
    const user = await prisma.user.create({
      data: {
        id: supabaseUser?.id,
        name,
        phone,
        email,
        passwordHash: supabaseUser ? null : await bcrypt.hash(password, 12),
        managerId: accountType === "EMPLOYEE" ? supervisor : null,
        supervisor: accountType === "EMPLOYEE" ? supervisor : null,
        accountType,
      },
    });
    return publicUser(user);
  } catch (error) {
    if (supabaseAdmin && supabaseUser) await supabaseAdmin.auth.admin.deleteUser(supabaseUser.id);
    throw error;
  }
}

export async function loginUser(input) {
  const email = String(input.email || "").trim().toLowerCase();
  const password = String(input.password || "");
  if (!email || !password) {
    const error = new Error("Email and password are required.");
    error.statusCode = 400;
    throw error;
  }

  const supabaseAdmin = getSupabaseAdmin();
  if (supabaseAdmin) {
    const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });
    if (error) {
      const authError = new Error("Invalid email or password.");
      authError.statusCode = 401;
      throw authError;
    }
    const profile = await prisma.user.findUnique({ where: { id: data.user.id } });
    if (!profile) {
      const profileError = new Error("Your account profile is not configured.");
      profileError.statusCode = 403;
      throw profileError;
    }
    return { user: publicUser(profile), session: data.session };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
    const error = new Error("Invalid email or password.");
    error.statusCode = 401;
    throw error;
  }
  return { user: publicUser(user), session: null };
}

export async function getRegistrationOptions() {
  const activeSupervisors = await prisma.user.findMany({
    where: { accountType: "SUPERVISOR", status: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return {
    supervisors: activeSupervisors.map((user) => ({ value: user.id, label: user.name })),
    accountTypes,
  };
}
