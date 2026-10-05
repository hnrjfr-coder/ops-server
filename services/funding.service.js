import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

const accountNames = ["SWAGGZ", "METROFLEX", "MONETIZE", "NEILA"];
const accountCategories = ["SUBSCRIPTION", "RENEWAL"];

const fixedFundingAmounts = {
  SWAGGZ: { SUBSCRIPTION: 42000, RENEWAL: 49500 },
  METROFLEX: { SUBSCRIPTION: 42000, RENEWAL: 49500 },
  MONETIZE: { SUBSCRIPTION: 42000, RENEWAL: 49500 },
  NEILA: { SUBSCRIPTION: 35500, RENEWAL: 42000 },
};
const MAX_FUNDING_REQUESTS_PER_CYCLE = 4;
const hasPendingRefundOrReport = (request) =>
  [...(request.refunds || []), ...(request.reports || [])]
    .some((activity) => activity.status === "PENDING_FUNDER_APPROVAL");
const hasDecidedRefundOrReport = (request) =>
  [...(request.refunds || []), ...(request.reports || [])]
    .some((activity) => ["APPROVED", "REJECTED"].includes(activity.status));

export const requestsSinceCompletedBatch = (requests) => {
  const cycleRequests = requests.filter((request) =>
    !["FUNDER_REJECTED", "SUPERVISOR_REJECTED", "REFUNDED"].includes(request.status) &&
    !hasDecidedRefundOrReport(request),
  );
  for (let index = 0; index <= cycleRequests.length - MAX_FUNDING_REQUESTS_PER_CYCLE; index += 1) {
    const isCompletedBatch = cycleRequests
      .slice(index, index + MAX_FUNDING_REQUESTS_PER_CYCLE)
      .every((request) => request.status === "COMPLETED");
    if (isCompletedBatch) return index;
  }
  return cycleRequests.length;
};

export const hasUnsubmittedApprovedFundingRequest = (requests) =>
  requests.some((request) =>
    request.status === "APPROVED" && !request.work &&
    !hasPendingRefundOrReport(request) && !hasDecidedRefundOrReport(request),
  );

export function getFundingRequestBlockReason(requests) {
  const activeRequests = requests.filter((request) =>
    !["FUNDER_REJECTED", "SUPERVISOR_REJECTED", "REFUNDED"].includes(request.status) &&
    !hasDecidedRefundOrReport(request),
  );
  if (activeRequests.some((request) => request.status === "PENDING_FUNDER_APPROVAL")) {
    return "AWAITING_FUNDER_APPROVAL";
  }
  if (activeRequests.some((request) => hasPendingRefundOrReport(request) || request.status === "REFUND_PENDING")) {
    return "AWAITING_REFUND_OR_REPORT_APPROVAL";
  }
  if (hasUnsubmittedApprovedFundingRequest(activeRequests)) return "AWAITING_WORK_SUBMISSION";
  return null;
}

const resolveFixedAmount = (accountName, accountCategory) => {
  const normalizedAccountName = String(accountName || "").trim().toUpperCase();
  const normalizedAccountCategory = String(accountCategory || "").trim().toUpperCase();

  if (!accountNames.includes(normalizedAccountName)) {
    const error = new Error("Select a valid account name: SWAGGZ, METROFLEX, MONETIZE, or NEILA.");
    error.statusCode = 400;
    throw error;
  }

  if (!accountCategories.includes(normalizedAccountCategory)) {
    const error = new Error("Select a valid account category: SUBSCRIPTION or RENEWAL.");
    error.statusCode = 400;
    throw error;
  }

  const amount = fixedFundingAmounts[normalizedAccountName]?.[normalizedAccountCategory];
  if (!amount) {
    const error = new Error("No fixed funding amount was defined for that account and billing type.");
    error.statusCode = 400;
    throw error;
  }

  return { accountName: normalizedAccountName, accountCategory: normalizedAccountCategory, amount };
};

const parsePagination = (input = {}) => {
  const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(input.pageSize, 10) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize };
};

const paginatedResult = (items, total, page, pageSize) => ({
  items,
  pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) },
});

export function getFundingDateRange(input = {}) {
  const from = String(input.from || "");
  const to = String(input.to || "");
  if (!from && !to) return null;
  if (!from || !to) {
    const error = new Error("Provide both from and to dates.");
    error.statusCode = 400;
    throw error;
  }
  const isValidDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if (!isValidDate(from) || !isValidDate(to)) {
    const error = new Error("from and to must be valid dates in YYYY-MM-DD format.");
    error.statusCode = 400;
    throw error;
  }
  if (from > to) {
    const error = new Error("from must be on or before to.");
    error.statusCode = 400;
    throw error;
  }
  const start = new Date(`${from}T00:00:00+01:00`);
  const endExclusive = new Date(`${to}T00:00:00+01:00`);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  return { from, to, start, endExclusive };
}

export function getActiveApprovedFundingWhere(where = {}) {
  return {
    ...where,
    status: "APPROVED",
    reports: { none: {} },
    refunds: { none: {} },
  };
}

export function getUnusedApprovedFundingWhere(where = {}) {
  return {
    ...getActiveApprovedFundingWhere(where),
    work: null,
  };
}

export function getFundingRequestSupervisorId(employee, funder) {
  const supervisor = employee.manager;
  if (!supervisor || supervisor.accountType !== "SUPERVISOR" || supervisor.status !== "ACTIVE") {
    const error = new Error("An active supervisor must be assigned before requesting funding.");
    error.statusCode = 409;
    throw error;
  }
  if (supervisor.funder?.id !== funder.id) {
    const error = new Error("The employee's supervisor is not assigned to the selected funder.");
    error.statusCode = 409;
    throw error;
  }
  return supervisor.id;
}

export function getConfirmedFundingWhere(where = {}) {
  return {
    ...where,
    approvedAt: { not: null },
  };
}

export function getFunderOverviewWhere(funderId) {
  return {
    funderId,
    status: "PENDING_FUNDER_APPROVAL",
    work: null,
  };
}

export function getFunderAttendedWhere(funderId) {
  return {
    funderId,
    OR: [
      { status: { not: "PENDING_FUNDER_APPROVAL" } },
      { work: { isNot: null } },
    ],
  };
}

export function getConfirmedFundingPeriodWhere(funderId, dateRange) {
  return {
    funderId,
    approvedAt: { gte: dateRange.start, lt: dateRange.endExclusive },
  };
}

async function fundingSummary(where) {
  const [groups, approved] = await Promise.all([
    prisma.fundingRequest.groupBy({
      by: ["status"],
      where: { ...where, status: { not: "APPROVED" } },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.fundingRequest.aggregate({
      where: getConfirmedFundingWhere(where),
      _count: { _all: true },
      _sum: { amount: true },
    }),
  ]);
  return {
    ...Object.fromEntries(groups.map((group) => [group.status, {
    count: group._count._all,
    amount: group._sum.amount || 0,
    }])),
    APPROVED: {
      count: approved._count._all,
      amount: approved._sum.amount || 0,
    },
  };
}

export async function createFundingRequest(employeeId, input) {
  const selectedAccountName = input.accountName ?? input.account ?? null;
  const selectedAccountCategory = input.accountCategory ?? input.purpose ?? null;
  const { accountName, accountCategory, amount } = resolveFixedAmount(selectedAccountName, selectedAccountCategory);

  return prisma.$transaction(async (transaction) => {
  await transaction.$queryRaw`SELECT "id" FROM "ops"."User" WHERE "id" = ${employeeId} FOR UPDATE`;
  const employee = await transaction.user.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      accountType: true,
      status: true,
      manager: {
        select: {
          id: true,
          accountType: true,
          status: true,
          funder: { select: { id: true, accountType: true, status: true } },
        },
      },
    },
  });
  if (!employee || employee.accountType !== "EMPLOYEE" || employee.status !== "ACTIVE") {
    const error = new Error("Active employee account was not found.");
    error.statusCode = 404;
    throw error;
  }
  const funder = employee.manager?.funder;
  if (!funder || funder.accountType !== "FUNDER" || funder.status !== "ACTIVE") {
    const error = new Error("The assigned supervisor does not have an active funder.");
    error.statusCode = 409;
    throw error;
  }
  const supervisorId = getFundingRequestSupervisorId(employee, funder);

  const fundingCycleRequests = await transaction.fundingRequest.findMany({
    where: { employeeId },
    orderBy: { requestedAt: "desc" },
    select: {
      status: true,
      work: { select: { id: true } },
      reports: { orderBy: { requestedAt: "desc" }, select: { id: true, status: true }, take: 1 },
      refunds: { orderBy: { requestedAt: "desc" }, select: { id: true, status: true }, take: 1 },
    },
  });
  const requestBlockReason = getFundingRequestBlockReason(fundingCycleRequests);
  if (requestBlockReason) {
    const message = requestBlockReason === "AWAITING_REFUND_OR_REPORT_APPROVAL"
      ? "Wait for the funder to decide your refund or use-of-funds report before requesting more funding."
      : requestBlockReason === "AWAITING_FUNDER_APPROVAL"
        ? "Wait for your current funding request to be approved before requesting more. Submit work for it before requesting again."
        : "Submit work for your approved funding request before requesting more funding. Supervisor approval is not required to request the next funding.";
    const error = new Error(message);
    error.statusCode = 409;
    throw error;
  }
  const fundingCycleRequestCount = requestsSinceCompletedBatch(fundingCycleRequests);
  if (fundingCycleRequestCount >= MAX_FUNDING_REQUESTS_PER_CYCLE) {
    const error = new Error(`You have reached the limit of ${MAX_FUNDING_REQUESTS_PER_CYCLE} active funding requests in this cycle. Complete all four requests before requesting more. Refund and report requests release a slot after the funder decides them.`);
    error.statusCode = 409;
    throw error;
  }

  const requestedAt = new Date();
  return transaction.fundingRequest.create({
    data: {
      employeeId,
      supervisorId,
      funderId: funder.id,
      accountName,
      accountCategory,
      amount,
      purpose: `${accountName} ${accountCategory}`,
      requestedAt,
      lastStatusChangedAt: requestedAt,
    },
    include: {
      supervisor: { select: { id: true, name: true } },
      funder: { select: { id: true, name: true } },
    },
  });
  });
}

export async function listEmployeeFundingRequests(employeeId, input = {}) {
  const { page, pageSize, skip } = parsePagination(input);
  const dateRange = getFundingDateRange(input);
  const status = String(input.status || "").trim();
  const where = {
    employeeId,
    ...(status ? { status } : {}),
    ...(dateRange ? { requestedAt: { gte: dateRange.start, lt: dateRange.endExclusive } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.fundingRequest.findMany({
      where,
      select: {
        id: true,
        employeeId: true,
        funderId: true,
        supervisorId: true,
        accountName: true,
        accountCategory: true,
        amount: true,
        purpose: true,
        status: true,
        requestedAt: true,
        approvedAt: true,
        completedAt: true,
        supervisor: { select: { id: true, name: true } },
        funder: { select: { id: true, name: true } },
        work: { select: { id: true, accountName: true, accountCategory: true, status: true, completedAt: true, submittedAt: true, approvedAt: true, updatedAt: true } },
        refunds: {
          orderBy: { requestedAt: "desc" },
          take: 1,
          select: { id: true, status: true, requestedAt: true, processedAt: true, paymentReference: true, funderNote: true },
        },
        reports: {
          orderBy: { requestedAt: "desc" },
          take: 1,
          select: { id: true, reason: true, status: true, requestedAt: true, processedAt: true, funderNote: true },
        },
      },
      orderBy: { requestedAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.fundingRequest.count({ where }),
  ]);
  return paginatedResult(items, total, page, pageSize);
}

export async function getEmployeeFundingSummary(employeeId, input = {}) {
  const dateRange = getFundingDateRange(input);
  const summaryWhere = {
    employeeId,
    ...(dateRange ? { requestedAt: { gte: dateRange.start, lt: dateRange.endExclusive } } : {}),
  };
  const [summary, cycleRows] = await Promise.all([
    fundingSummary(summaryWhere),
    prisma.$queryRaw`
    WITH request_state AS (
      SELECT
        funding."id",
        funding."status",
        funding."requestedAt",
        EXISTS (
          SELECT 1 FROM "ops"."WorkSubmission" work
          WHERE work."fundingRequestId" = funding."id"
        ) AS "hasWork",
        (
          SELECT refund."status" FROM "ops"."RefundRequest" refund
          WHERE refund."fundingRequestId" = funding."id"
          ORDER BY refund."requestedAt" DESC, refund."id" DESC
          LIMIT 1
        ) AS "latestRefundStatus",
        (
          SELECT report."status" FROM "ops"."FundingReport" report
          WHERE report."fundingRequestId" = funding."id"
          ORDER BY report."requestedAt" DESC, report."id" DESC
          LIMIT 1
        ) AS "latestReportStatus"
      FROM "ops"."FundingRequest" funding
      WHERE funding."employeeId" = ${employeeId}
    ),
    cycle_requests AS (
      SELECT
        request_state.*,
        ROW_NUMBER() OVER (ORDER BY request_state."requestedAt" DESC, request_state."id" DESC) AS "position"
      FROM request_state
      WHERE request_state."status" NOT IN ('FUNDER_REJECTED', 'SUPERVISOR_REJECTED', 'REFUNDED')
        AND request_state."latestRefundStatus" IS DISTINCT FROM 'APPROVED'
        AND request_state."latestRefundStatus" IS DISTINCT FROM 'REJECTED'
        AND request_state."latestReportStatus" IS DISTINCT FROM 'APPROVED'
        AND request_state."latestReportStatus" IS DISTINCT FROM 'REJECTED'
    ),
    reset_point AS (
      SELECT MIN(first_request."position") AS "position"
      FROM cycle_requests first_request
      JOIN cycle_requests second_request ON second_request."position" = first_request."position" + 1
      JOIN cycle_requests third_request ON third_request."position" = first_request."position" + 2
      JOIN cycle_requests fourth_request ON fourth_request."position" = first_request."position" + 3
      WHERE first_request."status" = 'COMPLETED'
        AND second_request."status" = 'COMPLETED'
        AND third_request."status" = 'COMPLETED'
        AND fourth_request."status" = 'COMPLETED'
    ),
    cycle_counts AS (
      SELECT COUNT(*)::int AS total FROM cycle_requests
    ),
    cycle_flags AS (
      SELECT
        COALESCE(BOOL_OR("status" = 'PENDING_FUNDER_APPROVAL'), false) AS "awaitingFunder",
        COALESCE(BOOL_OR(
          "status" = 'APPROVED' AND NOT "hasWork"
          AND "latestRefundStatus" IS DISTINCT FROM 'PENDING_FUNDER_APPROVAL'
          AND "latestReportStatus" IS DISTINCT FROM 'PENDING_FUNDER_APPROVAL'
          AND "latestRefundStatus" IS DISTINCT FROM 'APPROVED'
          AND "latestRefundStatus" IS DISTINCT FROM 'REJECTED'
          AND "latestReportStatus" IS DISTINCT FROM 'APPROVED'
          AND "latestReportStatus" IS DISTINCT FROM 'REJECTED'
        ), false) AS "awaitingWork"
      FROM cycle_requests
    ),
    activity_flags AS (
      SELECT
        (SELECT COALESCE(BOOL_OR("status" = 'PENDING_FUNDER_APPROVAL'), false) FROM request_state) AS "awaitingFunder",
        (SELECT COALESCE(BOOL_OR(
          "latestRefundStatus" = 'PENDING_FUNDER_APPROVAL'
          OR "latestReportStatus" = 'PENDING_FUNDER_APPROVAL'
        ), false) FROM request_state) AS "hasPendingActivity",
        (SELECT COALESCE(BOOL_OR(
          "latestRefundStatus" = 'PENDING_FUNDER_APPROVAL'
          OR "latestReportStatus" = 'PENDING_FUNDER_APPROVAL'
          OR "status" = 'REFUND_PENDING'
        ), false) FROM cycle_requests) AS "awaitingRefundOrReport"
    )
    SELECT
      COALESCE(reset_point."position"::int - 1, cycle_counts.total) AS "fundingCycleRequestCount",
      cycle_flags."awaitingWork" AS "fundingRequestAwaitingWork",
      activity_flags."hasPendingActivity" AS "fundingRequestAwaitingRefundOrReportApproval",
      activity_flags."awaitingFunder" AS "fundingRequestAwaitingFunderApproval",
      CASE
        WHEN cycle_flags."awaitingFunder" THEN 'AWAITING_FUNDER_APPROVAL'
        WHEN activity_flags."awaitingRefundOrReport" THEN 'AWAITING_REFUND_OR_REPORT_APPROVAL'
        WHEN cycle_flags."awaitingWork" THEN 'AWAITING_WORK_SUBMISSION'
        ELSE NULL
      END AS "fundingRequestBlockReason"
    FROM reset_point, cycle_counts, cycle_flags, activity_flags
    `,
  ]);
  const [cycleState] = cycleRows;
  const fundingCycleRequestCount = cycleState.fundingCycleRequestCount;
  const fundingRequestBlockReason = cycleState.fundingRequestBlockReason;
  const fundingRequestAwaitingWork = cycleState.fundingRequestAwaitingWork;
  const fundingRequestAwaitingRefundOrReportApproval = cycleState.fundingRequestAwaitingRefundOrReportApproval;
  const fundingRequestAwaitingFunderApproval = cycleState.fundingRequestAwaitingFunderApproval;
  const fundingRequestCycleLimitReached = fundingCycleRequestCount >= MAX_FUNDING_REQUESTS_PER_CYCLE;
  return {
    ...summary,
    maxFundingRequestsPerCycle: MAX_FUNDING_REQUESTS_PER_CYCLE,
    fundingCycleRequestCount,
    fundingRequestAwaitingWork,
    fundingRequestAwaitingRefundOrReportApproval,
    fundingRequestAwaitingFunderApproval,
    fundingRequestCycleLimitReached,
    fundingRequestBlockReason,
    fundingRequestBlocked: Boolean(fundingRequestBlockReason) || fundingRequestCycleLimitReached,
  };
}

export async function listFunderFundingRequests(funderId, input = {}) {
  const { page, pageSize, skip } = parsePagination(input);
  const where = input.view === "overview"
    ? getFunderOverviewWhere(funderId)
    : input.view === "attended"
      ? getFunderAttendedWhere(funderId)
      : input.view === "unused"
        ? getUnusedApprovedFundingWhere({ funderId })
      : { funderId };
  const [items, total] = await Promise.all([
    prisma.fundingRequest.findMany({
      where,
      include: {
        employee: { select: {
          id: true,
          name: true,
          phone: true,
          fundingBankName: true,
          fundingAccountHolderName: true,
          fundingAccountNumber: true,
        } },
        supervisor: { select: { id: true, name: true } },
        funder: { select: { id: true, name: true } },
        work: { select: { id: true, accountName: true, accountCategory: true, status: true, completedAt: true, submittedAt: true } },
        ...(input.view !== "overview" && {
          refunds: {
            orderBy: { requestedAt: "desc" },
            take: 1,
            select: { id: true, status: true, requestedAt: true, employeeConfirmedAt: true, paymentReference: true, funderNote: true },
          },
          reports: {
            orderBy: { requestedAt: "desc" },
            take: 1,
            select: { id: true, status: true, requestedAt: true, processedAt: true, reason: true, funderNote: true },
          },
        }),
      },
      orderBy: input.view === "overview"
        ? [{ requestedAt: "desc" }]
        : [
          { lastStatusChangedAt: { sort: "desc", nulls: "last" } },
          { requestedAt: "desc" },
        ],
      skip,
      take: pageSize,
    }),
    prisma.fundingRequest.count({ where }),
  ]);
  const funderItems = items.map((request) => {
    if (request.status === "PENDING_FUNDER_APPROVAL") return request;
    return {
      ...request,
      employee: {
        id: request.employee.id,
        name: request.employee.name,
        phone: request.employee.phone,
      },
    };
  });
  return paginatedResult(funderItems, total, page, pageSize);
}

export async function getFunderFundingSummary(funderId, input = {}) {
  const dateRange = getFundingDateRange(input);
  const [summary, unusedFunding] = await Promise.all([
    fundingSummary({ funderId }),
    prisma.fundingRequest.aggregate({
      where: getUnusedApprovedFundingWhere({ funderId }),
      _count: { _all: true },
      _sum: { amount: true },
    }),
  ]);
  const summaryWithUnusedFunding = {
    ...summary,
    unusedFunding: {
      count: unusedFunding._count._all,
      amount: unusedFunding._sum.amount || 0,
    },
  };
  if (!dateRange) return summaryWithUnusedFunding;
  const funded = await prisma.fundingRequest.aggregate({
    where: getConfirmedFundingPeriodWhere(funderId, dateRange),
    _count: { _all: true },
    _sum: { amount: true },
  });
  return {
    ...summaryWithUnusedFunding,
    fundedPeriod: {
      from: dateRange.from,
      to: dateRange.to,
      timezone: "Africa/Lagos",
      count: funded._count._all,
      amount: funded._sum.amount || 0,
    },
  };
}

export async function listSupervisorFundingRequests(supervisorId, input = {}) {
  const { page, pageSize, skip } = parsePagination(input);
  const dateRange = getFundingDateRange(input);
  const status = String(input.status || "").trim();
  const where = {
    supervisorId,
    ...(status ? { status } : {}),
    ...(dateRange ? { requestedAt: { gte: dateRange.start, lt: dateRange.endExclusive } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.fundingRequest.findMany({
      where,
      include: {
        employee: { select: { id: true, name: true, phone: true } },
        funder: { select: { id: true, name: true } },
        work: { select: { id: true, accountName: true, accountCategory: true, status: true, completedAt: true, submittedAt: true } },
        refunds: {
          orderBy: { requestedAt: "desc" },
          take: 1,
          select: { id: true, status: true, requestedAt: true, processedAt: true },
        },
        reports: {
          orderBy: { requestedAt: "desc" },
          take: 1,
          select: { id: true, status: true, requestedAt: true, processedAt: true },
        },
      },
      orderBy: { requestedAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.fundingRequest.count({ where }),
  ]);
  return paginatedResult(items, total, page, pageSize);
}

export async function getSupervisorFundingSummary(supervisorId, input = {}) {
  const dateRange = getFundingDateRange(input);
  const summaryWhere = {
    supervisorId,
    ...(dateRange ? { requestedAt: { gte: dateRange.start, lt: dateRange.endExclusive } } : {}),
  };
  const summary = await fundingSummary(summaryWhere);
  const pendingDateFilter = dateRange
    ? Prisma.sql`AND "requestedAt" >= ${dateRange.start} AND "requestedAt" < ${dateRange.endExclusive}`
    : Prisma.empty;
  const [pendingUsers] = await prisma.$queryRaw`
    SELECT COUNT(DISTINCT "employeeId")::int AS count
    FROM "ops"."FundingRequest"
    WHERE "supervisorId" = ${supervisorId}
      AND "status" = 'PENDING_FUNDER_APPROVAL'
      ${pendingDateFilter}
  `;
  return { ...summary, pendingRequestUserCount: pendingUsers.count };
}

export async function decideFundingRequest(funderId, requestId, decision, transferConfirmed = false) {
  if (!["APPROVED", "REJECTED"].includes(decision)) {
    const error = new Error("Decision must be APPROVED or REJECTED.");
    error.statusCode = 400;
    throw error;
  }
  if (decision === "APPROVED" && transferConfirmed !== true) {
    const error = new Error("Confirm that funding was transferred before approving this request.");
    error.statusCode = 400;
    throw error;
  }
  const decidedAt = new Date();
  return prisma.$transaction(async (transaction) => {
    if (decision === "APPROVED") {
      const pendingRequest = await transaction.fundingRequest.findFirst({
        where: { id: requestId, funderId, status: "PENDING_FUNDER_APPROVAL" },
        select: {
          supervisorId: true,
          employee: {
            select: {
              fundingBankName: true,
              fundingAccountHolderName: true,
              fundingAccountNumber: true,
            },
          },
        },
      });
      const employeeAccount = pendingRequest?.employee;
      const accountIsComplete = Boolean(
        employeeAccount?.fundingBankName?.trim() &&
        employeeAccount?.fundingAccountHolderName?.trim() &&
        /^\d{10}$/.test(employeeAccount?.fundingAccountNumber?.trim() || ""),
      );
      if (pendingRequest && !accountIsComplete) {
        const error = new Error("The employee funding account is incomplete. Update the account details before approval.");
        error.statusCode = 409;
        throw error;
      }
      if (pendingRequest) {
        const supervisor = await transaction.user.findFirst({
          where: {
            id: pendingRequest.supervisorId || "",
            accountType: "SUPERVISOR",
            status: "ACTIVE",
            funderId,
          },
          select: { id: true },
        });
        if (!supervisor) {
          const error = new Error("The assigned supervisor is not active. Contact an administrator before approving this request.");
          error.statusCode = 409;
          throw error;
        }
      }
    }

    const updated = await transaction.fundingRequest.updateMany({
      where: { id: requestId, funderId, status: "PENDING_FUNDER_APPROVAL" },
      data: {
        status: decision === "APPROVED" ? "APPROVED" : "FUNDER_REJECTED",
        approvedAt: decision === "APPROVED" ? decidedAt : null,
        lastStatusChangedAt: decidedAt,
      },
    });
    if (updated.count !== 1) {
      const request = await transaction.fundingRequest.findFirst({
        where: { id: requestId, funderId },
        select: { id: true },
      });
      if (!request) {
        const error = new Error("Funding request was not found for this funder.");
        error.statusCode = 404;
        throw error;
      }
      const error = new Error("Only requests awaiting funder approval can be decided.");
      error.statusCode = 409;
      throw error;
    }
    const result = await transaction.fundingRequest.findUnique({
      where: { id: requestId },
      include: {
        employee: { select: { id: true, name: true, phone: true } },
        supervisor: { select: { id: true, name: true } },
        funder: { select: { id: true, name: true } },
      },
    });
    if (!result) {
      const error = new Error("Funding request was not found for this funder.");
      error.statusCode = 404;
      throw error;
    }
    return result;
  });
}