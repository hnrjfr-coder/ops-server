import { prisma } from "./prisma.js";

export async function findUserByAuthIdentity(identity, userRepository = prisma.user) {
  if (identity?.id) {
    const userById = await userRepository.findUnique({ where: { id: identity.id } });
    if (userById) return userById;
  }

  const email = String(identity?.email || "").trim().toLowerCase();
  if (!email) return null;
  return userRepository.findUnique({ where: { email } });
}
