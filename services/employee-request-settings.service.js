import { prisma } from "../lib/prisma.js";

export const EMPLOYEE_REQUESTS_CLOSED_MESSAGE =
  "The current work period has now closed while the team completes month-end processing. New employee requests are paused for now. You can still view your dashboard and existing records. We’ll let you know as soon as the next work period opens. Thank you for your work and patience.";

const SETTING_ID = "global";

export async function getEmployeeRequestSettings(database = prisma) {
  const setting = await database.employeeRequestSetting.findUnique({
    where: { id: SETTING_ID },
    select: { enabled: true },
  });
  return { enabled: setting?.enabled ?? true, message: EMPLOYEE_REQUESTS_CLOSED_MESSAGE };
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
  return { enabled: setting.enabled, message: EMPLOYEE_REQUESTS_CLOSED_MESSAGE };
}
