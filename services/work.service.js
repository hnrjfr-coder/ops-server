import { prisma } from "../lib/prisma.js";
import { getFundingDateRange } from "./funding.service.js";

export const isFundingRequestEligibleForWork = (request) =>
  request?.status === "APPROVED" && !request.work && !request.reports?.length && !request.refunds?.length;

const paginationFor = (input = {}) => {
  const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
  const pageSize = Math.min(20, Math.max(1, Number.parseInt(input.pageSize, 10) || 10));
  return { page, pageSize, skip: (page - 1) * pageSize };
};

export async function createWorkSubmission(input) {
  const employeeId = String(input.employeeId || "").trim();
  const fundingRequestId = String(input.fundingRequestId || "").trim();
  const notes = String(input.notes || "").trim() || null;

  if (!employeeId || !fundingRequestId) {
    const error = new Error("fundingRequestId is required.");
    error.statusCode = 400;
    throw error;
  }

  return prisma.$transaction(async (transaction) => {
    const employee = await transaction.user.findUnique({ where: { id: employeeId } });
    if (!employee || employee.accountType !== "EMPLOYEE" || employee.status !== "ACTIVE") {
      const error = new Error("Active employee account was not found.");
      error.statusCode = 404;
      throw error;
    }
    await transaction.$queryRaw`SELECT "id" FROM "ops"."FundingRequest" WHERE "id" = ${fundingRequestId} FOR UPDATE`;
    const fundingRequest = await transaction.fundingRequest.findFirst({
      where: { id: fundingRequestId, employeeId, status: "APPROVED", work: null, reports: { none: {} }, refunds: { none: {} } },
      include: {
        supervisor: { select: { id: true, status: true, accountType: true } },
        reports: { select: { id: true }, take: 1 },
        refunds: { select: { id: true }, take: 1 },
      },
    });
    if (!fundingRequest) {
      const error = new Error("This funding is no longer eligible for work submission. Reported, refunded, or already-used funding cannot be selected.");
      error.statusCode = 409;
      throw error;
    }
    if (!isFundingRequestEligibleForWork(fundingRequest)) {
      const error = new Error("This funding is no longer eligible for work submission.");
      error.statusCode = 409;
      throw error;
    }
    const accountName = String(fundingRequest.accountName || "").trim();
    const accountCategory = String(fundingRequest.accountCategory || "").trim().toUpperCase();
    if (!accountName || !["SUBSCRIPTION", "RENEWAL"].includes(accountCategory)) {
      const error = new Error("The approved funding request has incomplete package details.");
      error.statusCode = 409;
      throw error;
    }
    if (!fundingRequest.supervisor || fundingRequest.supervisor.status !== "ACTIVE" || fundingRequest.supervisor.accountType !== "SUPERVISOR") {
      const error = new Error("The supervisor assigned to this funding request is not active.");
      error.statusCode = 409;
      throw error;
    }

    const submittedAt = new Date();
    const claimedRequest = await transaction.fundingRequest.updateMany({
      where: { id: fundingRequestId, employeeId, status: "APPROVED", reports: { none: {} }, refunds: { none: {} } },
      data: { status: "UNDER_SUPERVISOR_REVIEW", lastStatusChangedAt: submittedAt },
    });
    if (claimedRequest.count !== 1) {
      const error = new Error("Funding request is no longer approved for work submission.");
      error.statusCode = 409;
      throw error;
    }

    return transaction.workSubmission.create({
      data: {
        employeeId,
        fundingRequestId,
        accountName,
        legacyDescription: "",
        accountCategory,
        completedAt: submittedAt,
        submittedAt,
        amount: fundingRequest.amount,
        notes,
        supervisorId: fundingRequest.supervisorId,
        status: "UNDER_REVIEW",
      },
      select: {
        id: true,
        accountName: true,
        accountCategory: true,
        completedAt: true,
        amount: true,
        notes: true,
        status: true,
        submittedAt: true,
        approvedAt: true,
        updatedAt: true,
        employeeId: true,
        supervisorId: true,
        fundingRequestId: true,
        fundingRequest: true,
        supervisor: { select: { id: true, name: true } },
      },
    });
  });
}

export function listWorkSubmissions(employeeId) {
  return prisma.workSubmission.findMany({
    where: employeeId ? { employeeId } : undefined,
    select: {
      id: true,
      accountName: true,
      accountCategory: true,
      completedAt: true,
      amount: true,
      notes: true,
      status: true,
      submittedAt: true,
      approvedAt: true,
      updatedAt: true,
      employeeId: true,
      supervisorId: true,
      fundingRequestId: true,
      payment: true,
      fundingRequest: {
        select: {
          id: true,
          status: true,
          accountName: true,
          accountCategory: true,
          amount: true,
          approvedAt: true,
          completedAt: true,
          requestedAt: true,
        },
      },
      supervisor: { select: { id: true, name: true } },
    },
    orderBy: { submittedAt: "desc" },
  });
}

export function listPaymentRequests(employeeId) {
  return prisma.paymentRequest.findMany({
    where: employeeId ? { employeeId } : undefined,
    include: {
      work: {
        select: {
          id: true,
          accountName: true,
          accountCategory: true,
          completedAt: true,
          amount: true,
          notes: true,
          status: true,
          submittedAt: true,
          approvedAt: true,
          updatedAt: true,
          employeeId: true,
          supervisorId: true,
          fundingRequestId: true,
        },
      },
    },
    orderBy: { requestedAt: "desc" },
  });
}

export async function getEarnings(employeeId) {
  const payments = await listPaymentRequests(employeeId);
  const paid = payments.filter((payment) => payment.status === "PAID");
  const approved = payments.filter((payment) => ["APPROVED", "PAID"].includes(payment.status));
  const pending = payments.filter((payment) => ["PENDING", "PROCESSING"].includes(payment.status));
  return {
    totals: {
      earned: approved.reduce((sum, payment) => sum + payment.amount, 0),
      paid: paid.reduce((sum, payment) => sum + payment.amount, 0),
      pending: pending.reduce((sum, payment) => sum + payment.amount, 0),
    },
    payments,
  };
}

export async function getSupervisorWorks(supervisorId, input = {}) {
  const { page, pageSize, skip } = paginationFor(input);
  const dateRange = getFundingDateRange(input);
  const status = String(input.status || "").trim();
  const summaryWhere = {
    supervisorId,
    ...(dateRange ? { submittedAt: { gte: dateRange.start, lt: dateRange.endExclusive } } : {}),
  };
  const where = { ...summaryWhere, ...(status ? { status } : {}) };
  const [works, total, statusGroups, pendingEmployees, pendingPayouts] = await Promise.all([
    prisma.workSubmission.findMany({
    where,
    select: {
      id: true,
      accountName: true,
      accountCategory: true,
      completedAt: true,
      amount: true,
      notes: true,
      status: true,
      submittedAt: true,
      approvedAt: true,
      updatedAt: true,
      employeeId: true,
      supervisorId: true,
      fundingRequestId: true,
      employee: { select: { id: true, name: true, email: true } },
      payment: true,
      fundingRequest: { select: { id: true, status: true, amount: true, accountName: true, accountCategory: true } },
    },
    orderBy: { submittedAt: "desc" },
    skip,
    take: pageSize,
    }),
    prisma.workSubmission.count({ where }),
    prisma.workSubmission.groupBy({ by: ["status"], where: summaryWhere, _count: { _all: true } }),
    prisma.workSubmission.findMany({
      where: { ...summaryWhere, status: "UNDER_REVIEW" },
      distinct: ["employeeId"],
      select: { employeeId: true },
    }),
    prisma.workSubmission.count({
      where: { ...summaryWhere, payment: { is: { status: "PENDING" } } },
    }),
  ]);
  const counts = Object.fromEntries(statusGroups.map((group) => [group.status, group._count._all]));
  const submitted = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const underReview = counts.UNDER_REVIEW || 0;
  const approved = (counts.APPROVED || 0) + (counts.COMPLETED || 0) + (counts.PAID || 0);
  return {
    totals: {
      submitted,
      underReview,
      approved,
      pendingPayouts,
      underReviewEmployeeCount: pendingEmployees.length,
    },
    works,
    pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) },
  };
}

export function getSupervisorEmployees(supervisorId) {
  return prisma.user.findMany({
    where: { managerId: supervisorId, accountType: "EMPLOYEE" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,
      createdAt: true,
    },
    orderBy: { name: "asc" },
  });
}

export async function updateSupervisedWorkStatus(supervisorId, workId, status) {
  const allowedStatuses = ["APPROVED", "REJECTED"];
  if (!allowedStatuses.includes(status)) {
    const error = new Error("Invalid work status.");
    error.statusCode = 400;
    throw error;
  }
  const decidedAt = new Date();
  return prisma.$transaction(async (transaction) => {
    const work = await transaction.workSubmission.findFirst({
      where: { id: workId, supervisorId },
    });
    if (!work) {
      const error = new Error("Work submission was not found in your supervision list.");
      error.statusCode = 404;
      throw error;
    }
    if (work.status !== "UNDER_REVIEW") {
      const error = new Error("Only work awaiting supervisor review can be decided.");
      error.statusCode = 409;
      throw error;
    }
    const workStatus = status === "APPROVED" && work.fundingRequestId ? "COMPLETED" : status;
    const updatedWork = await transaction.workSubmission.updateMany({
      where: { id: workId, supervisorId, status: "UNDER_REVIEW" },
      data: { status: workStatus, approvedAt: status === "APPROVED" ? decidedAt : null },
    });
    if (updatedWork.count !== 1) {
      const error = new Error("Work was already decided by another request.");
      error.statusCode = 409;
      throw error;
    }
    if (work.fundingRequestId) {
      const updatedRequest = await transaction.fundingRequest.updateMany({
        where: { id: work.fundingRequestId, status: "UNDER_SUPERVISOR_REVIEW" },
        data: {
          status: status === "APPROVED" ? "COMPLETED" : "SUPERVISOR_REJECTED",
          completedAt: status === "APPROVED" ? decidedAt : null,
          lastStatusChangedAt: decidedAt,
        },
      });
      if (updatedRequest.count !== 1) {
        const error = new Error("Funding request is no longer awaiting supervisor review.");
        error.statusCode = 409;
        throw error;
      }
    } else {
      await transaction.paymentRequest.updateMany({
        where: { workId },
        data: { status: status === "APPROVED" ? "APPROVED" : "REJECTED" },
      });
    }
    return transaction.workSubmission.findUnique({
      where: { id: workId },
      select: {
        id: true,
        accountName: true,
        accountCategory: true,
        completedAt: true,
        amount: true,
        notes: true,
        status: true,
        submittedAt: true,
        approvedAt: true,
        updatedAt: true,
        employeeId: true,
        supervisorId: true,
        fundingRequestId: true,
        payment: true,
        fundingRequest: true,
        employee: { select: { id: true, name: true, email: true } },
        supervisor: { select: { id: true, name: true } },
      },
    });
  });
}
