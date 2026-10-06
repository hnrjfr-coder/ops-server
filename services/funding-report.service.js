import { prisma } from "../lib/prisma.js";

const pageArgs = (input = {}) => {
  const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(input.pageSize, 10) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize };
};

function serviceError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

const eligibleFundingWhere = {
  approvedAt: { not: null },
  work: null,
  status: { notIn: ["REFUND_PENDING", "REFUNDED"] },
  refunds: { none: { status: { in: ["PENDING_FUNDER_APPROVAL", "APPROVED"] } } },
};

export async function createEmployeeFundingReport(employeeId, fundingRequestId) {
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT "id" FROM "ops"."FundingRequest" WHERE "id" = ${fundingRequestId} FOR UPDATE`;
    const funding = await transaction.fundingRequest.findFirst({
      where: { id: fundingRequestId, employeeId, ...eligibleFundingWhere },
      select: { id: true, funderId: true },
    });
    if (!funding) throw serviceError("Only confirmed funding without an active or approved refund can be reported.", 409);

    const existingReport = await transaction.fundingReport.findFirst({
      where: {
        fundingRequestId,
        status: { in: ["PENDING_FUNDER_APPROVAL", "APPROVED"] },
      },
      select: { id: true },
    });
    if (existingReport) throw serviceError("This funding already has a pending or approved report.", 409);

    return transaction.fundingReport.create({
      data: {
        fundingRequestId,
        employeeId,
        funderId: funding.funderId,
        reason: "Use-of-funds report submitted.",
      },
      include: {
        fundingRequest: { select: { id: true, accountName: true, accountCategory: true, amount: true, status: true } },
      },
    });
  });
}

export async function listEmployeeFundingReports(employeeId, input = {}) {
  const { page, pageSize, skip } = pageArgs(input);
  const where = { employeeId };
  const [items, total] = await Promise.all([
    prisma.fundingReport.findMany({
      where,
      include: {
        fundingRequest: { select: { id: true, accountName: true, accountCategory: true, amount: true, status: true } },
        funder: { select: { id: true, name: true } },
      },
      orderBy: { requestedAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.fundingReport.count({ where }),
  ]);
  return { items, pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) } };
}

export async function getEmployeeFundingReportSummary(employeeId) {
  const [summary] = await prisma.$queryRaw`
    SELECT
      COALESCE(SUM(funding."amount") FILTER (WHERE report."status" = 'PENDING_FUNDER_APPROVAL'), 0)::float8 AS "pendingAmount",
      COALESCE(SUM(funding."amount") FILTER (WHERE report."status" IN ('APPROVED', 'REJECTED')), 0)::float8 AS "settledAmount"
    FROM "ops"."FundingReport" AS report
    JOIN "ops"."FundingRequest" AS funding ON funding."id" = report."fundingRequestId"
    WHERE report."employeeId" = ${employeeId}
  `;
  return {
    pendingAmount: Number(summary.pendingAmount),
    settledAmount: Number(summary.settledAmount),
  };
}

export async function listFunderFundingReports(funderId, input = {}) {
  const { page, pageSize, skip } = pageArgs(input);
  const where = { funderId };
  const [items, total, pendingCount] = await Promise.all([
    prisma.fundingReport.findMany({
      where,
      include: {
        employee: { select: { id: true, name: true, phone: true } },
        fundingRequest: { select: { id: true, accountName: true, accountCategory: true, amount: true, status: true } },
      },
      orderBy: { requestedAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.fundingReport.count({ where }),
    prisma.fundingReport.count({ where: { funderId, status: "PENDING_FUNDER_APPROVAL" } }),
  ]);
  return { items, pendingCount, pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) } };
}

export async function decideFundingReport(funderId, reportId, decision, funderNote = "") {
  if (!["APPROVED", "REJECTED"].includes(decision)) {
    throw serviceError("Decision must be APPROVED or REJECTED.", 400);
  }
  const processedAt = new Date();
  const updated = await prisma.fundingReport.updateMany({
    where: { id: reportId, funderId, status: "PENDING_FUNDER_APPROVAL" },
    data: {
      status: decision,
      processedAt,
      funderNote: String(funderNote || "").trim().slice(0, 500) || null,
    },
  });
  if (updated.count !== 1) throw serviceError("Pending funding report was not found for this funder.", 404);
  return prisma.fundingReport.findUnique({
    where: { id: reportId },
    include: {
      employee: { select: { id: true, name: true, phone: true } },
      fundingRequest: { select: { id: true, accountName: true, accountCategory: true, amount: true, status: true } },
    },
  });
}