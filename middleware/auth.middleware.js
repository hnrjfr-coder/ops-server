import { verifyAuth } from "@supabase/server/core";
import { prisma } from "../lib/prisma.js";

export function requireAccountType(...allowedTypes) {
  return async (request, response, next) => {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) return next();
    try {
      const webRequest = new Request(`http://${request.get("host")}${request.originalUrl}`, { headers: request.headers });
      const { data, error } = await verifyAuth(webRequest, { auth: "user" });
      if (error || !data?.userClaims?.id) return response.status(401).json({ error: "Authentication required." });
      const user = await prisma.user.findUnique({ where: { id: data.userClaims.id } });
      if (!user || !allowedTypes.includes(user.accountType)) return response.status(403).json({ error: "You are not allowed to access this workspace." });
      request.authUser = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}
