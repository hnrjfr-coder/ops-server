import { prisma } from "../lib/prisma.js";

export const FUNDER_FUNDING_AMOUNTS = Object.freeze([200_000, 500_000, 1_000_000, 2_000_000]);

export function isAllowedFunderFundingAmount(value) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && FUNDER_FUNDING_AMOUNTS.includes(amount);
}

const parsePagination = (input = {}) => {
  const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(input.pageSize, 10) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize };
};

const paginatedResult = (items, total, page, pageSize) => ({
  items,
  pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) },
});

function serviceError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getRequestDateRange(input = {}) {
  const from = String(input.from || "").trim();
  const to = String(input.to || "").trim();
  if (Boolean(from) !== Boolean(to)) {
    throw serviceError("Choose both From and To dates, or clear both dates.", 400);
  }
  if (!from) return null;
  const isDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if (!isDate(from) || !isDate(to) || from > to) {
    throw serviceError("Enter a valid date range with From on or before To.", 400);
  }
  const start = new Date(`${from}T00:00:00.000Z`);
  const endExclusive = new Date(`${to}T00:00:00.000Z`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return { gte: start, lt: endExclusive };
}

export async function createFunderFundingRequest(funderId, input = {}) {
  const amount = Number(input.amount);
  if (!isAllowedFunderFundingAmount(input.amount)) {
    throw serviceError("Choose one of the available funding amounts.", 400);
  }

  const funder = await prisma.user.findFirst({
    where: { id: funderId, accountType: "FUNDER" },
    select: {
      id: true,
      refundBankName: true,
      refundAccountHolderName: true,
      refundAccountNumber: true,
    },
  });
  if (!funder) throw serviceError("Funder account was not found.", 404);
  if (
    !funder.refundBankName?.trim() ||
    !funder.refundAccountHolderName?.trim() ||
    !/^\d{10}$/.test(funder.refundAccountNumber?.trim() || "")
  ) {
    throw serviceError("Set valid refund account details in your profile before requesting funding.", 409);
  }

  return prisma.funderFundingRequest.create({
    data: {
      funderId,
      amount,
      refundBankName: funder.refundBankName.trim(),
      refundAccountHolderName: funder.refundAccountHolderName.trim(),
      refundAccountNumber: funder.refundAccountNumber.trim(),
    },
  });
}

export async function listFunderAdminFundingRequests(funderId, input = {}) {
  const { page, pageSize, skip } = parsePagination(input);
  const where = { funderId };
  const [items, total] = await Promise.all([
    prisma.funderFundingRequest.findMany({
      where,
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
      skip,
      take: pageSize,
    }),
    prisma.funderFundingRequest.count({ where }),
  ]);
  return paginatedResult(items, total, page, pageSize);
}

export async function listAdminFunderFundingRequests(input = {}) {
  const { page, pageSize, skip } = parsePagination(input);
  const status = String(input.status || "").trim().toUpperCase();
  const search = String(input.search || "").trim();
  const dateRange = getRequestDateRange(input);
  const summaryWhere = {
    ...(dateRange ? { requestedAt: dateRange } : {}),
    ...(search
      ? {
          OR: [
            { id: { contains: search, mode: "insensitive" } },
            { funder: { is: { name: { contains: search, mode: "insensitive" } } } },
            { funder: { is: { email: { contains: search, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };
  const where = {
    ...summaryWhere,
    ...(status && status !== "ALL" ? { status } : {}),
  };
  const [items, total, statusGroups] = await Promise.all([
    prisma.funderFundingRequest.findMany({
      where,
      include: {
        funder: { select: { id: true, name: true, email: true, phone: true } },
        reviewer: { select: { id: true, name: true } },
      },
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
      skip,
      take: pageSize,
    }),
    prisma.funderFundingRequest.count({ where }),
    prisma.funderFundingRequest.groupBy({
      by: ["status"],
      where: summaryWhere,
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);
  const summary = {
    totalAmount: 0,
    pendingAmount: 0,
    approvedAmount: 0,
    rejectedAmount: 0,
    totalCount: 0,
    pendingCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
  };
  for (const group of statusGroups) {
    const amount = Number(group._sum.amount) || 0;
    const count = group._count._all;
    summary.totalAmount += amount;
    summary.totalCount += count;
    if (group.status === "PENDING") {
      summary.pendingAmount = amount;
      summary.pendingCount = count;
    } else if (group.status === "APPROVED") {
      summary.approvedAmount = amount;
      summary.approvedCount = count;
    } else if (group.status === "REJECTED") {
      summary.rejectedAmount = amount;
      summary.rejectedCount = count;
    }
  }
  return { ...paginatedResult(items, total, page, pageSize), summary };
}

export async function decideFunderFundingRequest(requestId, reviewerId, decision, adminNote = "") {
  if (!["APPROVED", "REJECTED"].includes(decision)) {
    throw serviceError("Decision must be APPROVED or REJECTED.", 400);
  }
  const result = await prisma.funderFundingRequest.updateMany({
    where: { id: requestId, status: "PENDING" },
    data: {
      status: decision,
      reviewerId,
      processedAt: new Date(),
      adminNote: String(adminNote || "").trim().slice(0, 1000) || null,
    },
  });
  if (result.count !== 1) {
    const existing = await prisma.funderFundingRequest.findUnique({
      where: { id: requestId },
      select: { id: true },
    });
    if (!existing) throw serviceError("Funder funding request was not found.", 404);
    throw serviceError("Only pending funder funding requests can be decided.", 409);
  }
  return prisma.funderFundingRequest.findUnique({
    where: { id: requestId },
    include: {
      funder: { select: { id: true, name: true, email: true, phone: true } },
      reviewer: { select: { id: true, name: true } },
    },
  });
}
