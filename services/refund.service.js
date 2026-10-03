import { prisma } from "../lib/prisma.js";

const pageArgs = (input = {}) => {
  const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
  const pageSize = Math.min(20, Math.max(1, Number.parseInt(input.pageSize, 10) || 10));
  return { page, pageSize, skip: (page - 1) * pageSize };
};

function serviceError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function assertRefundAccount(details) {
  const complete = Boolean(
    details.refundBankName?.trim() &&
      details.refundAccountHolderName?.trim() &&
      /^\d{10}$/.test(details.refundAccountNumber?.trim() || ""),
  );
  if (!complete) {
    throw serviceError("Your assigned funder has not completed valid refund account details yet.", 409);
  }
}

export async function getFunderRefundAccount(funderId) {
  const funder = await prisma.user.findFirst({
    where: { id: funderId, accountType: "FUNDER" },
    select: {
      refundBankName: true,
      refundAccountHolderName: true,
      refundAccountNumber: true,
    },
  });
  if (!funder) throw serviceError("Funder account was not found.", 404);
  return funder;
}

export async function updateFunderRefundAccount(funderId, input = {}) {
  const refundBankName = String(input.refundBankName || "").trim();
  const refundAccountHolderName = String(input.refundAccountHolderName || "").trim();
  const refundAccountNumber = String(input.refundAccountNumber || "").trim();
  if (!refundBankName || !refundAccountHolderName || !/^\d{10}$/.test(refundAccountNumber)) {
    throw serviceError("Enter the bank, account name, and a valid 10-digit account number.", 400);
  }
  return prisma.user.update({
    where: { id: funderId },
    data: { refundBankName, refundAccountHolderName, refundAccountNumber },
    select: { refundBankName: true, refundAccountHolderName: true, refundAccountNumber: true },
  });
}

export async function getEmployeeRefundDetails(employeeId, fundingRequestId) {
  const funding = await prisma.fundingRequest.findFirst({
    where: {
      id: fundingRequestId,
      employeeId,
      status: "APPROVED",
      work: null,
    },
    select: {
      id: true,
      amount: true,
      accountName: true,
      accountCategory: true,
      funder: {
        select: {
          id: true,
          name: true,
          refundBankName: true,
          refundAccountHolderName: true,
          refundAccountNumber: true,
        },
      },
    },
  });
  if (!funding) throw serviceError("Only your approved funding without submitted work can be refunded.", 409);
  const activeReport = await prisma.fundingReport.findFirst({
    where: {
      fundingRequestId: funding.id,
      status: { in: ["PENDING_FUNDER_APPROVAL", "APPROVED"] },
    },
    select: { id: true },
  });
  if (activeReport) throw serviceError("This funding already has a pending or approved use-of-funds report and cannot be refunded.", 409);
  assertRefundAccount(funding.funder);
  return funding;
}

export async function createEmployeeRefundRequest(employeeId, input = {}) {
  const fundingRequestId = String(input.fundingRequestId || "").trim();
  const paymentReference = String(input.paymentReference || "").trim().slice(0, 120) || null;
  if (!fundingRequestId) throw serviceError("fundingRequestId is required.", 400);
  if (input.paidConfirmed !== true) throw serviceError("Confirm that you paid the funder before submitting this refund.", 400);

  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT "id" FROM "ops"."FundingRequest" WHERE "id" = ${fundingRequestId} FOR UPDATE`;
    const funding = await transaction.fundingRequest.findFirst({
      where: { id: fundingRequestId, employeeId, status: "APPROVED", work: null },
      select: {
        id: true,
        amount: true,
        funderId: true,
        funder: {
          select: {
            refundBankName: true,
            refundAccountHolderName: true,
            refundAccountNumber: true,
          },
        },
      },
    });
    if (!funding) throw serviceError("Only your approved funding without submitted work can be refunded.", 409);
    assertRefundAccount(funding.funder);

    const activeReport = await transaction.fundingReport.findFirst({
      where: {
        fundingRequestId: funding.id,
        status: { in: ["PENDING_FUNDER_APPROVAL", "APPROVED"] },
      },
      select: { id: true },
    });
    if (activeReport) throw serviceError("This funding already has a pending or approved use-of-funds report and cannot be refunded.", 409);

    const requestedAt = new Date();
    const refund = await transaction.refundRequest.create({
      data: {
        fundingRequestId: funding.id,
        employeeId,
        funderId: funding.funderId,
        amount: funding.amount,
        paymentReference,
        employeeConfirmedAt: requestedAt,
        requestedAt,
      },
      include: {
        fundingRequest: { select: { id: true, accountName: true, accountCategory: true, amount: true } },
      },
    });
    const updated = await transaction.fundingRequest.updateMany({
      where: { id: funding.id, employeeId, status: "APPROVED" },
      data: { status: "REFUND_PENDING", lastStatusChangedAt: requestedAt },
    });
    if (updated.count !== 1) throw serviceError("Funding status changed before the refund was submitted. Refresh and try again.", 409);
    return refund;
  });
}

export async function listEmployeeRefundRequests(employeeId, input = {}) {
  const { page, pageSize, skip } = pageArgs(input);
  const where = { employeeId };
  const [items, total] = await Promise.all([
    prisma.refundRequest.findMany({
      where,
      include: {
        fundingRequest: { select: { id: true, accountName: true, accountCategory: true, amount: true } },
        funder: { select: { id: true, name: true } },
      },
      orderBy: { requestedAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.refundRequest.count({ where }),
  ]);
  return { items, pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) } };
}

export async function listFunderRefundRequests(funderId, input = {}) {
  const { page, pageSize, skip } = pageArgs(input);
  const where = { funderId };
  const [items, total, pendingCount] = await Promise.all([
    prisma.refundRequest.findMany({
      where,
      include: {
        employee: { select: { id: true, name: true, email: true } },
        fundingRequest: { select: { id: true, accountName: true, accountCategory: true, amount: true } },
      },
      orderBy: { requestedAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.refundRequest.count({ where }),
    prisma.refundRequest.count({ where: { funderId, status: "PENDING_FUNDER_APPROVAL" } }),
  ]);
  return { items, pendingCount, pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) } };
}

export async function decideRefundRequest(funderId, refundId, decision, funderNote = "") {
  if (!["APPROVED", "REJECTED"].includes(decision)) {
    throw serviceError("Decision must be APPROVED or REJECTED.", 400);
  }
  return prisma.$transaction(async (transaction) => {
    const refund = await transaction.refundRequest.findFirst({
      where: { id: refundId, funderId, status: "PENDING_FUNDER_APPROVAL" },
      select: { id: true, fundingRequestId: true },
    });
    if (!refund) throw serviceError("Pending refund request was not found for this funder.", 404);

    const processedAt = new Date();
    const updatedRefund = await transaction.refundRequest.updateMany({
      where: { id: refundId, funderId, status: "PENDING_FUNDER_APPROVAL" },
      data: {
        status: decision,
        processedAt,
        funderNote: String(funderNote || "").trim().slice(0, 500) || null,
      },
    });
    if (updatedRefund.count !== 1) throw serviceError("Refund request was already decided.", 409);

    const updatedFunding = await transaction.fundingRequest.updateMany({
      where: { id: refund.fundingRequestId, funderId, status: "REFUND_PENDING" },
      data: {
        status: decision === "APPROVED" ? "REFUNDED" : "APPROVED",
        lastStatusChangedAt: processedAt,
      },
    });
    if (updatedFunding.count !== 1) throw serviceError("The linked funding request is no longer awaiting refund review.", 409);

    return transaction.refundRequest.findUnique({
      where: { id: refundId },
      include: {
        employee: { select: { id: true, name: true, email: true } },
        fundingRequest: { select: { id: true, accountName: true, accountCategory: true, amount: true, status: true } },
      },
    });
  });
}