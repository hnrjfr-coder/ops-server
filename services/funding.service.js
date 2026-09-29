import { prisma } from "../lib/prisma.js";

const parseAmount = (value) => {
  const amount = Number(value);
  return Number.isInteger(amount) && amount > 0 ? amount : null;
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
  const amount = parseAmount(input.amount);
  const purpose = String(input.purpose || "").trim();
  if (!amount || !purpose) {
    const error = new Error("A positive amount and purpose are required.");
    error.statusCode = 400;
    throw error;
  }

  const employee = await prisma.user.findUnique({
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

  return prisma.fundingRequest.create({
    data: {
      employeeId,
      supervisorId: employee.manager.id,
      funderId: funder.id,
      amount,
      purpose,
    },
    include: {
      supervisor: { select: { id: true, name: true } },
      funder: { select: { id: true, name: true } },
    },
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
        work: { select: { id: true, title: true, status: true, completedAt: true, submittedAt: true } },
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
  return fundingSummary({ employeeId });
}

export async function listFunderFundingRequests(funderId, input = {}) {
  const { page, pageSize, skip } = parsePagination(input);
  const where = { funderId };
  const [items, total] = await Promise.all([
    prisma.fundingRequest.findMany({
      where,
      include: {
        employee: { select: { id: true, name: true, email: true } },
        supervisor: { select: { id: true, name: true } },
        work: { select: { id: true, title: true, status: true, completedAt: true, submittedAt: true } },
      },
      orderBy: { requestedAt: "desc" },
      skip,
      take: pageSize,
    }),
    prisma.fundingRequest.count({ where }),
  ]);
  return paginatedResult(items, total, page, pageSize);
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
        work: { select: { id: true, title: true, status: true, completedAt: true, submittedAt: true } },
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
  return fundingSummary({ supervisorId });
}

export async function decideFundingRequest(funderId, requestId, decision) {
  if (!["APPROVED", "REJECTED"].includes(decision)) {
    const error = new Error("Decision must be APPROVED or REJECTED.");
    error.statusCode = 400;
    throw error;
  }
  return prisma.$transaction(async (transaction) => {
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