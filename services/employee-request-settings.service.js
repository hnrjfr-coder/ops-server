import { prisma } from "../lib/prisma.js";

export const FUNDING_REQUESTS_CLOSED_MESSAGE =
  "The current work period has closed while we complete month-end processing, so new funding requests are temporarily paused. You can still submit work for funding that has already been approved, and view your existing records. We’ll let you know when new funding requests reopen. Thank you for your work and patience.";

const SETTING_ID = "global";

export async function getEmployeeRequestSettings(database = prisma) {
  const setting = await database.employeeRequestSetting.findUnique({
    where: { id: SETTING_ID },
    select: { enabled: true },
  });
  return { enabled: setting?.enabled ?? true, message: FUNDING_REQUESTS_CLOSED_MESSAGE };
}

export async function updateEmployeeRequestSettings(enabled, database = prisma) {
  if (typeof enabled !== "boolean") {
    const error = new Error("enabled must be a boolean.");
    error.statusCode = 400;
    throw error;
  }
  const setting = await database.employeeRequestSetting.upsert({
    where: { id: SETTING_ID },
    update: { enabled },
    create: { id: SETTING_ID, enabled },
    select: { enabled: true },
  });
  return { enabled: setting.enabled, message: FUNDING_REQUESTS_CLOSED_MESSAGE };
}
