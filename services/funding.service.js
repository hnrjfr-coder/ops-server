import { prisma } from "../lib/prisma.js";

const accountNames = ["SWAGGZ", "METROFLEX", "MONETIZE", "NEILA"];
const accountCategories = ["SUBSCRIPTION", "RENEWAL"];

const fixedFundingAmounts = {
  SWAGGZ: { SUBSCRIPTION: 42000, RENEWAL: 49500 },
  METROFLEX: { SUBSCRIPTION: 42000, RENEWAL: 49500 },
  MONETIZE: { SUBSCRIPTION: 42000, RENEWAL: 49500 },
  NEILA: { SUBSCRIPTION: 35000, RENEWAL: 42000 },
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

export function getConfirmedFundingWhere(where = {}) {
  return {
    ...where,
    approvedAt: { not: null },
  };
}

export function getFunderOverviewWhere(funderId) {
  return {
    funderId,
    status: { in: ["PENDING_FUNDER_APPROVAL", "APPROVED"] },
    refunds: { none: {} },
    reports: { none: {} },
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
      where: getActiveApprovedFundingWhere(where),
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
  if (!employee.manager || employee.manager.accountType !== "SUPERVISOR" || employee.manager.status !== "ACTIVE") {
    const error = new Error("An active supervisor must be assigned before requesting funding.");
    error.statusCode = 409;
    throw error;
  }
  const funder = employee.manager.funder;
  if (!funder || funder.accountType !== "FUNDER" || funder.status !== "ACTIVE") {
    const error = new Error("The assigned supervisor does not have an active funder.");
    error.statusCode = 409;
    throw error;
  }

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
      supervisorId: employee.manager.id,
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
  const summary = await fundingSummary(summaryWhere);
  const fundingCycleRequests = await prisma.fundingRequest.findMany({
    where: { employeeId },
    orderBy: { requestedAt: "desc" },
    select: {
      status: true,
      work: { select: { id: true } },
      reports: { orderBy: { requestedAt: "desc" }, select: { id: true, status: true }, take: 1 },
      refunds: { orderBy: { requestedAt: "desc" }, select: { id: true, status: true }, take: 1 },
    },
  });
  const fundingCycleRequestCount = requestsSinceCompletedBatch(fundingCycleRequests);
  const fundingRequestBlockReason = getFundingRequestBlockReason(fundingCycleRequests);
  const fundingRequestAwaitingWork = hasUnsubmittedApprovedFundingRequest(fundingCycleRequests);
  const fundingRequestAwaitingRefundOrReportApproval = fundingCycleRequests.some(hasPendingRefundOrReport);
  const fundingRequestAwaitingFunderApproval = fundingCycleRequests.some(
    (request) => request.status === "PENDING_FUNDER_APPROVAL",
  );
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
  const where = input.view === "overview" ? getFunderOverviewWhere(funderId) : { funderId };
  const [items, total] = await Promise.all([
    prisma.fundingRequest.findMany({
      where,
      include: {
        employee: { select: {
          id: true,
          name: true,
          email: true,
          fundingBankName: true,
          fundingAccountHolderName: true,
          fundingAccountNumber: true,
        } },
        supervisor: { select: { id: true, name: true } },
        work: { select: { id: true, accountName: true, accountCategory: true, status: true, completedAt: true, submittedAt: true } },
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
      },
      orderBy: { requestedAt: "desc" },
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
        email: request.employee.email,
      },
    };
  });
  return paginatedResult(funderItems, total, page, pageSize);
}

export async function getFunderFundingSummary(funderId, input = {}) {
  const dateRange = getFundingDateRange(input);
  const summary = await fundingSummary({ funderId });
  if (!dateRange) return summary;
  const funded = await prisma.fundingRequest.aggregate({
    where: getConfirmedFundingPeriodWhere(funderId, dateRange),
    _count: { _all: true },
    _sum: { amount: true },
  });
  return {
    ...summary,
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
        employee: { select: { id: true, name: true, email: true } },
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
  const pendingUsers = await prisma.fundingRequest.findMany({
    where: { ...summaryWhere, status: "PENDING_FUNDER_APPROVAL" },
    distinct: ["employeeId"],
    select: { employeeId: true },
  });
  return { ...summary, pendingRequestUserCount: pendingUsers.length };
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
        employee: { select: { id: true, name: true, email: true } },
        supervisor: { select: { id: true, name: true } },
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