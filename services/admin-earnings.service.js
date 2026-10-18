import { prisma } from "../lib/prisma.js";

export const ADMIN_SUBSCRIPTION_EARNING_RATES = Object.freeze({
  SWAGGZ: 8_000,
  METROFLEX: 8_000,
  NEILA: 6_500,
  MONETIZE: 8_000,
});

const accountNames = Object.keys(ADMIN_SUBSCRIPTION_EARNING_RATES);

function serviceError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getDateRange(input = {}) {
  const fromValue = String(input.from || "").trim();
  const toValue = String(input.to || "").trim();
  if (Boolean(fromValue) !== Boolean(toValue)) {
    throw serviceError("Choose both From and To dates, or clear both dates.");
  }
  if (!fromValue) return null;

  const parseDate = (value, field) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw serviceError(`${field} must use YYYY-MM-DD format.`);
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
      throw serviceError(`${field} must be a valid calendar date.`);
    }
    return date;
  };

  const from = parseDate(fromValue, "From");
  const to = parseDate(toValue, "To");
  if (from > to) throw serviceError("From must be on or before To.");
  to.setUTCDate(to.getUTCDate() + 1);
  return { gte: from, lt: to };
}

export function getAdminSubscriptionEarning(accountName) {
  return ADMIN_SUBSCRIPTION_EARNING_RATES[String(accountName || "").trim().toUpperCase()] || 0;
}

export async function getAdminEarnings(input = {}) {
  const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(input.pageSize, 10) || 20));
  const search = String(input.search || "").trim();
  const approvedAt = getDateRange(input);
  const where = {
    status: "COMPLETED",
    accountCategory: "SUBSCRIPTION",
    fundingRequest: {
      is: {
        accountCategory: "SUBSCRIPTION",
        accountName: { in: accountNames },
      },
    },
    approvedAt: { not: null, ...(approvedAt || {}) },
    ...(search
      ? {
          OR: [
            { id: { contains: search, mode: "insensitive" } },
            { accountName: { contains: search, mode: "insensitive" } },
            { employee: { is: { name: { contains: search, mode: "insensitive" } } } },
            { employee: { is: { email: { contains: search, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
  const skip = (page - 1) * pageSize;

  const [works, total, accountGroups] = await Promise.all([
    prisma.workSubmission.findMany({
      where,
      orderBy: [{ approvedAt: "desc" }, { id: "desc" }],
      skip,
      take: pageSize,
      select: {
        id: true,
        accountName: true,
        accountCategory: true,
        amount: true,
        approvedAt: true,
        fundingRequestId: true,
        employee: { select: { id: true, name: true, email: true } },
        fundingRequest: { select: { id: true, accountName: true, accountCategory: true } },
      },
    }),
    prisma.workSubmission.count({ where }),
    prisma.workSubmission.groupBy({
      by: ["accountName"],
      where,
      _count: { _all: true },
    }),
  ]);

  const byAccount = Object.fromEntries(accountNames.map((name) => [name, { count: 0, amount: 0 }]));
  for (const group of accountGroups) {
    const accountName = String(group.accountName || "").trim().toUpperCase();
    const rate = getAdminSubscriptionEarning(accountName);
    if (!rate || !byAccount[accountName]) continue;
    const count = group._count._all;
    byAccount[accountName] = { count, amount: count * rate };
  }
  const summary = Object.values(byAccount).reduce(
    (totals, account) => ({
      count: totals.count + account.count,
      amount: totals.amount + account.amount,
    }),
    { count: 0, amount: 0 },
  );

  return {
    items: works.map((work) => ({
      ...work,
      earningAmount: getAdminSubscriptionEarning(work.accountName),
    })),
    summary: { ...summary, byAccount },
    pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) },
  };
}
