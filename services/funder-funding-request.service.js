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
  const where = {
    ...(status && status !== "ALL" ? { status } : {}),
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
  const [items, total] = await Promise.all([
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
  ]);
  return paginatedResult(items, total, page, pageSize);
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
