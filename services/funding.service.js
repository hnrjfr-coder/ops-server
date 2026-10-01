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

export const requestsSinceCompletedBatch = (requests) => {
  const cycleRequests = requests.filter((request) => !["FUNDER_REJECTED", "SUPERVISOR_REJECTED"].includes(request.status));
  for (let index = 0; index <= cycleRequests.length - MAX_FUNDING_REQUESTS_PER_CYCLE; index += 1) {
    const isCompletedBatch = cycleRequests
      .slice(index, index + MAX_FUNDING_REQUESTS_PER_CYCLE)
      .every((request) => request.status === "COMPLETED");
    if (isCompletedBatch) return index;
  }
  return cycleRequests.length;
};

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

async function fundingSummary(where) {
  const groups = await prisma.fundingRequest.groupBy({
    by: ["status"],
    where,
    _count: { _all: true },
    _sum: { amount: true },
  });
  return Object.fromEntries(groups.map((group) => [group.status, {
    count: group._count._all,
    amount: group._sum.amount || 0,
  }]));
}

export async function createFundingRequest(employeeId, input) {
  const selectedAccountName = input.accountName ?? input.account ?? null;
  const selectedAccountCategory = input.accountCategory ?? input.purpose ?? null;
  const { accountName, accountCategory, amount } = resolveFixedAmount(selectedAccountName, selectedAccountCategory);

  return prisma.$transaction(async (transaction) => {
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
    select: { status: true },
  });
  const fundingCycleRequestCount = requestsSinceCompletedBatch(fundingCycleRequests);
  if (fundingCycleRequestCount >= MAX_FUNDING_REQUESTS_PER_CYCLE) {
    const error = new Error(`You have reached the limit of ${MAX_FUNDING_REQUESTS_PER_CYCLE} active funding requests in this cycle. Complete and receive supervisor approval for all four requests before requesting more funding. Funder- or supervisor-rejected requests release their slot.`);
    error.statusCode = 409;
    throw error;
  }

  return transaction.fundingRequest.create({
    data: {
      employeeId,
      supervisorId: employee.manager.id,
      funderId: funder.id,
      accountName,
      accountCategory,
      amount,
      purpose: `${accountName} ${accountCategory}`,
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
  const where = { employeeId };
  const [items, total] = await Promise.all([
    prisma.fundingRequest.findMany({
      where,
      include: {
        supervisor: { select: { id: true, name: true } },
        funder: { select: { id: true, name: true } },
        work: { select: { id: true, accountName: true, accountCategory: true, status: true, completedAt: true, submittedAt: true } },
      },
      orderBy: { requestedAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.fundingRequest.count({ where }),
  ]);
  return paginatedResult(items, total, page, pageSize);
}

export async function getEmployeeFundingSummary(employeeId) {
  const summary = await fundingSummary({ employeeId });
  const fundingCycleRequests = await prisma.fundingRequest.findMany({
    where: { employeeId },
    orderBy: { requestedAt: "desc" },
    select: { status: true },
  });
  const fundingCycleRequestCount = requestsSinceCompletedBatch(fundingCycleRequests);
  return {
    ...summary,
    maxFundingRequestsPerCycle: MAX_FUNDING_REQUESTS_PER_CYCLE,
    fundingCycleRequestCount,
    fundingRequestBlocked: fundingCycleRequestCount >= MAX_FUNDING_REQUESTS_PER_CYCLE,
  };
}

export async function listFunderFundingRequests(funderId, input = {}) {
  const { page, pageSize, skip } = parsePagination(input);
  const where = { funderId };
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

export async function getFunderFundingSummary(funderId) {
  return fundingSummary({ funderId });
}

export async function listSupervisorFundingRequests(supervisorId, input = {}) {
  const { page, pageSize, skip } = parsePagination(input);
  const where = { supervisorId };
  const [items, total] = await Promise.all([
    prisma.fundingRequest.findMany({
      where,
      include: {
        employee: { select: { id: true, name: true, email: true } },
        funder: { select: { id: true, name: true } },
        work: { select: { id: true, accountName: true, accountCategory: true, status: true, completedAt: true, submittedAt: true } },
      },
      orderBy: { requestedAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.fundingRequest.count({ where }),
  ]);
  return paginatedResult(items, total, page, pageSize);
}

export async function getSupervisorFundingSummary(supervisorId) {
  const summary = await fundingSummary({ supervisorId });
  const pendingUsers = await prisma.fundingRequest.findMany({
    where: { supervisorId, status: "PENDING_FUNDER_APPROVAL" },
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
        approvedAt: decision === "APPROVED" ? new Date() : null,
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