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

export function getAdminPendingSubscriptionsWhere() {
  return {
    status: "UNDER_REVIEW",
    accountCategory: "SUBSCRIPTION",
    fundingRequest: {
      is: {
        status: "UNDER_SUPERVISOR_REVIEW",
        accountCategory: "SUBSCRIPTION",
        accountName: { in: accountNames },
      },
    },
  };
}

export function sumAdminSubscriptionEarnings(groups = []) {
  return groups.reduce((total, group) => {
    const count = Number(group?._count?._all) || 0;
    return total + count * getAdminSubscriptionEarning(group?.accountName);
  }, 0);
}

function getAdminEarningWorkWhere() {
  return {
    status: "COMPLETED",
    accountCategory: "SUBSCRIPTION",
    fundingRequest: {
      is: {
        accountCategory: "SUBSCRIPTION",
        accountName: { in: accountNames },
      },
    },
    approvedAt: { not: null },
  };
}

function parsePagination(input = {}) {
  const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(input.pageSize, 10) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize };
}

export async function getAdminEarnings(input = {}) {
  const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(input.pageSize, 10) || 20));
  const search = String(input.search || "").trim();
  const approvedAt = getDateRange(input);
  const where = {
    ...getAdminEarningWorkWhere(),
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

  const [works, total, accountGroups, lifetimeAccountGroups, pendingSubscriptionGroups, withdrawals] = await Promise.all([
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
    prisma.workSubmission.groupBy({
      by: ["accountName"],
      where: getAdminEarningWorkWhere(),
      _count: { _all: true },
    }),
    prisma.workSubmission.groupBy({
      by: ["accountName"],
      where: getAdminPendingSubscriptionsWhere(),
      _count: { _all: true },
    }),
    prisma.adminEarningWithdrawal.aggregate({ _sum: { amount: true } }),
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
  const earnedAmount = sumAdminSubscriptionEarnings(lifetimeAccountGroups);
  const withdrawnAmount = withdrawals._sum.amount || 0;
  const earnedCount = lifetimeAccountGroups.reduce((count, group) => count + group._count._all, 0);

  return {
    items: works.map((work) => ({
      ...work,
      earningAmount: getAdminSubscriptionEarning(work.accountName),
    })),
    summary: {
      ...summary,
      byAccount,
      earnedCount,
      earnedAmount,
      withdrawnAmount,
      balance: earnedAmount - withdrawnAmount,
      pendingSubscriptionCount: pendingSubscriptionGroups.reduce(
        (count, group) => count + group._count._all,
        0,
      ),
      pendingSubscriptionAmount: sumAdminSubscriptionEarnings(pendingSubscriptionGroups),
    },
    pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) },
  };
}

export async function createAdminEarningWithdrawal(input = {}, adminId) {
  const payload = input && typeof input === "object" ? input : {};
  const amount = payload.amount;
  const purpose = typeof payload.purpose === "string" ? payload.purpose.trim() : "";
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 2_147_483_647) {
    throw serviceError("Enter a valid withdrawal amount between 1 and 2,147,483,647 NGN.");
  }
  if (!purpose || purpose.length > 500) {
    throw serviceError("Enter a withdrawal purpose between 1 and 500 characters.");
  }
  if (!adminId) throw serviceError("An authenticated admin account is required.", 401);

  try {
    return await prisma.$transaction(async (transaction) => {
      const admin = await transaction.user.findUnique({
        where: { id: adminId },
        select: { id: true, accountType: true },
      });
      if (!admin || admin.accountType !== "ADMIN") {
        throw serviceError("Admin account was not found.", 403);
      }
      const [earnedGroups, withdrawals] = await Promise.all([
        transaction.workSubmission.groupBy({
          by: ["accountName"],
          where: getAdminEarningWorkWhere(),
          _count: { _all: true },
        }),
        transaction.adminEarningWithdrawal.aggregate({ _sum: { amount: true } }),
      ]);
      const balance = sumAdminSubscriptionEarnings(earnedGroups) - (withdrawals._sum.amount || 0);
      if (amount > balance) {
        throw serviceError(`Withdrawal amount exceeds the available balance of ${balance} NGN.`, 409);
      }
      return transaction.adminEarningWithdrawal.create({
        data: { amount, purpose, adminId: admin.id },
        select: {
          id: true,
          amount: true,
          purpose: true,
          createdAt: true,
          admin: { select: { id: true, name: true, email: true } },
        },
      });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error.code === "P2034") {
      throw serviceError("The available balance changed while recording the withdrawal. Refresh and try again.", 409);
    }
    throw error;
  }
}

export async function listAdminEarningWithdrawals(input = {}) {
  const { page, pageSize, skip } = parsePagination(input);
  const [items, total] = await Promise.all([
    prisma.adminEarningWithdrawal.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: pageSize,
      select: {
        id: true,
        amount: true,
        purpose: true,
        createdAt: true,
        admin: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.adminEarningWithdrawal.count(),
  ]);
  return {
    items,
    pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) },
  };
}

export async function listAdminPendingSubscriptions(input = {}) {
  const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(input.pageSize, 10) || 20));
  const where = getAdminPendingSubscriptionsWhere();
  const [items, total] = await Promise.all([
    prisma.workSubmission.findMany({
      where,
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        accountName: true,
        accountCategory: true,
        submittedAt: true,
        employee: { select: { id: true, name: true, phone: true, email: true } },
        supervisor: { select: { id: true, name: true, email: true, phone: true } },
        fundingRequest: { select: { id: true, accountName: true, accountCategory: true } },
      },
    }),
    prisma.workSubmission.count({ where }),
  ]);
  return {
    items,
    pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) },
  };
}
