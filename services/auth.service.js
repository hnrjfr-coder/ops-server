import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { getSupabaseAdmin } from "../lib/supabase.js";
import { accountTypes, isValidRegistrationOption } from "../config/registration-options.js";

const publicUser = (user) => {
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
};

const accountSetupFields = [
  "fundingBankName",
  "fundingAccountHolderName",
  "fundingAccountNumber",
  "payoutBankName",
  "payoutAccountHolderName",
  "payoutAccountNumber",
];

const isValidAccountSetupValue = (field, value) => {
  const text = String(value ?? "").trim();
  if (field.endsWith("AccountNumber")) return /^\d{10}$/.test(text);
  if (field.endsWith("AccountHolderName")) return /^[\p{L}][\p{L}\s.'-]{1,99}$/u.test(text);
  return /^[\p{L}\p{N}][\p{L}\p{N}\s&.'()-]{1,99}$/u.test(text);
};

const accountSetupInput = (input) =>
  Object.fromEntries(accountSetupFields.map((field) => [field, String(input[field] ?? "").trim()]));

export function getInitialAccountStatus(accountType) {
  return String(accountType || "").toUpperCase() === "EMPLOYEE" ? "PENDING_ADMIN_APPROVAL" : "ACTIVE";
}

export function resolveRegistrationSupervisor(supervisors) {
  if (supervisors.length !== 1) {
    const error = new Error(supervisors.length === 0
      ? "The selected funder has no active supervisor and cannot be selected."
      : "The selected funder has multiple active supervisors. Contact an administrator to resolve the assignment.");
    error.statusCode = 400;
    throw error;
  }
  return supervisors[0].id;
}

export function resolveEmployeeRegistrationAssignment(funder, supervisors) {
  if (funder.manualSupervisorRouting) {
    return { managerId: null, funderId: funder.id, supervisor: null };
  }
  const supervisor = resolveRegistrationSupervisor(supervisors);
  return { managerId: supervisor, funderId: null, supervisor };
}

export async function registerUser(input) {
  const name = String(input.name || "").trim();
  const phone = String(input.phone || "").trim();
  const email = String(input.email || "").trim().toLowerCase();
  const password = String(input.password || "");
  const funder = String(input.funder || "").trim();
  const accountType = String(input.accountType || "").trim().toUpperCase();
  const accountSetup = accountSetupInput(input);
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
  if (accountType !== "EMPLOYEE") {
    const error = new Error("Public registration is only available for employee accounts.");
    error.statusCode = 403;
    throw error;
  }
  if (!funder) {
    const error = new Error("Select a funder.");
    error.statusCode = 400;
    throw error;
  }
  if (password.length < 8) {
    const error = new Error("Password must be at least 8 characters.");
    error.statusCode = 400;
    throw error;
  }
  const invalidSetupField = accountSetupFields.find((field) => !isValidAccountSetupValue(field, accountSetup[field]));
  if (invalidSetupField) {
    const error = new Error("Enter valid bank, account holder, and 10-digit account details for both funding and payout.");
    error.statusCode = 400;
    throw error;
  }
  if (!isValidRegistrationOption(registrationOptions.funders, funder)) {
    const error = new Error("Select a valid active funder.");
    error.statusCode = 400;
    throw error;
  }
  const selectedFunder = await prisma.user.findFirst({
    where: { id: funder, accountType: "FUNDER", status: "ACTIVE" },
    select: { id: true, manualSupervisorRouting: true },
  });
  if (!selectedFunder) {
    const error = new Error("Select a valid active funder.");
    error.statusCode = 400;
    throw error;
  }
  const supervisors = selectedFunder.manualSupervisorRouting
    ? []
    : await prisma.user.findMany({
      where: { funderId: funder, accountType: "SUPERVISOR", status: "ACTIVE" },
      select: { id: true },
    });
  const assignment = resolveEmployeeRegistrationAssignment(selectedFunder, supervisors);
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
      email_confirm: true,
      user_metadata: {
        name,
        phone,
        supervisor: assignment.supervisor,
        funder,
        accountType,
        status: getInitialAccountStatus(accountType),
        ...accountSetup,
      },
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
        ...assignment,
        accountType,
        status: getInitialAccountStatus(accountType),
        ...accountSetup,
      },
    });
    return publicUser(user);
  } catch (error) {
    if (supabaseAdmin && supabaseUser) await supabaseAdmin.auth.admin.deleteUser(supabaseUser.id);
    throw error;
  }
}

export async function completeAccountSetup(userId, input) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    const error = new Error("Account not found.");
    error.statusCode = 404;
    throw error;
  }

  const submitted = accountSetupInput(input);
  const updates = {};
  for (const field of accountSetupFields) {
    const existing = String(user[field] ?? "").trim();
    if (isValidAccountSetupValue(field, existing)) continue;
    if (!isValidAccountSetupValue(field, submitted[field])) {
      const error = new Error("Complete each missing bank, account holder, and 10-digit account detail.");
      error.statusCode = 400;
      throw error;
    }
    updates[field] = submitted[field];
  }

  const updatedUser = Object.keys(updates).length
    ? await prisma.user.update({ where: { id: userId }, data: updates })
    : user;
  return publicUser(updatedUser);
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
  const [activeSupervisors, activeFunders] = await Promise.all([
    prisma.user.findMany({
      where: { accountType: "SUPERVISOR", status: "ACTIVE" },
      select: { id: true, name: true, funderId: true },
      orderBy: { name: "asc" },
    }),
    prisma.user.findMany({
      where: { accountType: "FUNDER", status: "ACTIVE" },
      select: { id: true, name: true, manualSupervisorRouting: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return {
    supervisors: activeSupervisors.map((user) => ({ value: user.id, label: user.name })),
    funders: activeFunders.map((user) => ({
      value: user.id,
      label: user.name,
      manualSupervisorRouting: user.manualSupervisorRouting,
      supervisorCount: user.manualSupervisorRouting
        ? null
        : activeSupervisors.filter((supervisor) => supervisor.funderId === user.id).length,
    })),
    accountTypes,
  };
}
