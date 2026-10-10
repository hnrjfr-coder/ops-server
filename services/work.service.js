import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { getFundingDateRange } from "./funding.service.js";

const parsePagination = (input = {}) => {
  const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(input.pageSize, 10) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize };
};

const paginatedResult = (items, total, page, pageSize) => ({
  items,
  pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) },
});

export const isFundingRequestEligibleForWork = (request) =>
  request?.status === "APPROVED" && !request.work && !request.reports?.length && !request.refunds?.length;

const paginationFor = (input = {}) => {
  const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
  const pageSize = Math.min(20, Math.max(1, Number.parseInt(input.pageSize, 10) || 10));
  return { page, pageSize, skip: (page - 1) * pageSize };
};

export function getPendingFirstPagePlan(skip, pageSize, pendingCount) {
  const pendingTake = Math.max(0, Math.min(pageSize, pendingCount - skip));
  return {
    pendingTake,
    reviewedSkip: Math.max(0, skip - pendingCount),
    reviewedTake: pageSize - pendingTake,
  };
}

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

const workListSelection = {
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
  payment: { select: { id: true, status: true, amount: true, requestedAt: true, processedAt: true } },
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
};

export async function listWorkSubmissions(employeeId, input = {}) {
  const { page, pageSize, skip } = parsePagination(input);
  const dateRange = getFundingDateRange(input);
  const search = String(input.search || "").trim();
  const status = String(input.status || "").trim();
  const where = {
    employeeId,
    ...(status ? { status } : {}),
    ...(dateRange ? { submittedAt: { gte: dateRange.start, lt: dateRange.endExclusive } } : {}),
    ...(search ? {
      OR: [
        { accountName: { contains: search, mode: "insensitive" } },
        { accountCategory: { contains: search, mode: "insensitive" } },
      ],
    } : {}),
  };
  const [items, total, statusGroups] = await Promise.all([
    prisma.workSubmission.findMany({
      where,
      select: workListSelection,
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      skip,
      take: pageSize,
    }),
    prisma.workSubmission.count({ where }),
    prisma.workSubmission.groupBy({
      by: ["status"],
      where: { employeeId },
      _count: { _all: true },
    }),
  ]);
  return {
    ...paginatedResult(items, total, page, pageSize),
    statusCounts: Object.fromEntries(statusGroups.map((group) => [group.status, group._count._all])),
  };
}

export function getEmployeeWorkSubmission(employeeId, workId) {
  return prisma.workSubmission.findFirst({
    where: { id: workId, employeeId },
    select: workListSelection,
  });
}

export async function listPaymentRequests(employeeId, input = {}) {
  const { page, pageSize, skip } = parsePagination(input);
  const status = String(input.status || "").trim().toUpperCase();
  const where = { employeeId, ...(status ? { status } : {}) };
  const [items, total] = await Promise.all([
    prisma.paymentRequest.findMany({
      where,
      select: {
        id: true,
        amount: true,
        status: true,
        requestedAt: true,
        processedAt: true,
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
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
      skip,
      take: pageSize,
    }),
    prisma.paymentRequest.count({ where }),
  ]);
  return paginatedResult(items, total, page, pageSize);
}

export async function getEarnings(employeeId, input = {}) {
  const [groups, paymentPage] = await Promise.all([
    prisma.paymentRequest.groupBy({
      by: ["status"],
      where: { employeeId },
      _sum: { amount: true },
    }),
    listPaymentRequests(employeeId, input),
  ]);
  const totalsByStatus = Object.fromEntries(groups.map((group) => [group.status, group._sum.amount || 0]));
  return {
    totals: {
      earned: (totalsByStatus.APPROVED || 0) + (totalsByStatus.PAID || 0),
      paid: totalsByStatus.PAID || 0,
      pending: (totalsByStatus.PENDING || 0) + (totalsByStatus.PROCESSING || 0),
    },
    payments: paymentPage.items,
    pagination: paymentPage.pagination,
  };
}

export async function getSupervisorWorks(supervisorId, input = {}) {
  const { page, pageSize, skip } = paginationFor(input);
  const from = String(input.from || "");
  const to = String(input.to || "");
  const dateRange = from || to
    ? getFundingDateRange({ from: from || to, to: to || from })
    : null;
  const status = String(input.status || "").trim();
  const queueView = input.view === "queue";
  const search = String(input.search || "").trim();
  const submittedAt = dateRange
    ? {
        ...(from ? { gte: dateRange.start } : {}),
        ...(to ? { lt: dateRange.endExclusive } : {}),
      }
    : undefined;
  const summaryWhere = {
    supervisorId,
    ...(submittedAt ? { submittedAt } : {}),
  };
  const where = {
    ...summaryWhere,
    ...(queueView ? { status: "UNDER_REVIEW" } : status ? { status } : {}),
    ...(search ? {
      OR: [
        { accountName: { contains: search, mode: "insensitive" } },
        { accountCategory: { contains: search, mode: "insensitive" } },
        { employee: { is: { name: { contains: search, mode: "insensitive" } } } },
        { employee: { is: { phone: { contains: search, mode: "insensitive" } } } },
      ],
    } : {}),
  };
  const pendingDateFilter = dateRange
    ? Prisma.sql`
      ${from ? Prisma.sql`AND "submittedAt" >= ${dateRange.start}` : Prisma.empty}
      ${to ? Prisma.sql`AND "submittedAt" < ${dateRange.endExclusive}` : Prisma.empty}
    `
    : Prisma.empty;
  const [total, statusGroups, pendingEmployees, pendingPayouts, pendingCount, pendingEmployeeGroups] = await Promise.all([
    prisma.workSubmission.count({ where }),
    prisma.workSubmission.groupBy({ by: ["status"], where: summaryWhere, _count: { _all: true } }),
    prisma.$queryRaw`
      SELECT COUNT(DISTINCT "employeeId")::int AS count
      FROM "ops"."WorkSubmission"
      WHERE "supervisorId" = ${supervisorId}
        AND "status" = 'UNDER_REVIEW'
        ${pendingDateFilter}
    `,
    prisma.workSubmission.count({
      where: { ...summaryWhere, payment: { is: { status: "PENDING" } } },
    }),
    status && status !== "UNDER_REVIEW"
      ? 0
      : prisma.workSubmission.count({ where: { ...where, status: "UNDER_REVIEW" } }),
    prisma.workSubmission.groupBy({
      by: ["employeeId"],
      where: { supervisorId, status: "UNDER_REVIEW" },
      _count: { _all: true },
    }),
  ]);
  const { pendingTake, reviewedSkip, reviewedTake } = getPendingFirstPagePlan(skip, pageSize, pendingCount);
  const selection = {
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
    employee: { select: { id: true, name: true, phone: true } },
    payment: { select: { id: true, status: true, requestedAt: true, processedAt: true } },
    fundingRequest: { select: { id: true, status: true, amount: true, accountName: true, accountCategory: true } },
  };
  const recordsView = input.view === "records";
  const [pendingWorks, reviewedWorks] = await Promise.all([
    recordsView || queueView
      ? prisma.workSubmission.findMany({
          where,
          select: selection,
          orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
          skip,
          take: pageSize,
        })
      : pendingTake > 0
      ? prisma.workSubmission.findMany({
          where: { ...where, status: "UNDER_REVIEW" },
          select: selection,
          orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
          skip,
          take: pendingTake,
        })
      : [],
    recordsView || queueView
      ? []
      : reviewedTake > 0
      ? prisma.workSubmission.findMany({
          where: status ? where : { ...where, status: { not: "UNDER_REVIEW" } },
          select: selection,
          orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
          skip: reviewedSkip,
          take: reviewedTake,
        })
      : [],
  ]);
  const pendingEmployeeCounts = new Map(
    pendingEmployeeGroups.map((group) => [group.employeeId, group._count._all]),
  );
  const works = [...pendingWorks, ...reviewedWorks].map((work) => ({
    ...work,
    employeePendingCount: pendingEmployeeCounts.get(work.employeeId) || 0,
  }));
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
      underReviewEmployeeCount: pendingEmployees[0]?.count || 0,
    },
    works,
    pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) },
  };
}

export async function getSupervisorEmployees(supervisorId, input = {}) {
  const { page, pageSize, skip } = parsePagination(input);
  const search = String(input.search || "").trim();
  const where = {
    accountType: "EMPLOYEE",
    OR: [
      { managerId: supervisorId },
      { work: { some: { supervisorId } } },
    ],
    ...(search ? {
      AND: [{
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { phone: { contains: search, mode: "insensitive" } },
        ],
      }],
    } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        createdAt: true,
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip,
      take: pageSize,
    }),
    prisma.user.count({ where }),
  ]);
  return paginatedResult(items, total, page, pageSize);
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
        payment: { select: { id: true, status: true, amount: true, requestedAt: true, processedAt: true } },
        fundingRequest: { select: { id: true, status: true, amount: true } },
        employee: { select: { id: true, name: true, phone: true } },
        supervisor: { select: { id: true, name: true } },
      },
    });
  });
}

export async function approveSupervisedEmployeeWorks(supervisorId, employeeId) {
  if (!String(employeeId || "").trim()) {
    const error = new Error("Select an employee whose work you want to approve.");
    error.statusCode = 400;
    throw error;
  }

  try {
    return await prisma.$transaction(async (transaction) => {
      const works = await transaction.workSubmission.findMany({
        where: { supervisorId, employeeId, status: "UNDER_REVIEW" },
        select: { id: true, fundingRequestId: true },
      });
      if (works.length === 0) {
        const error = new Error("This employee has no work awaiting your review.");
        error.statusCode = 409;
        throw error;
      }

      const decidedAt = new Date();
      for (const work of works) {
        const updatedWork = await transaction.workSubmission.updateMany({
          where: { id: work.id, supervisorId, employeeId, status: "UNDER_REVIEW" },
          data: {
            status: work.fundingRequestId ? "COMPLETED" : "APPROVED",
            approvedAt: decidedAt,
          },
        });
        if (updatedWork.count !== 1) {
          const error = new Error("A work submission was already decided by another request.");
          error.statusCode = 409;
          throw error;
        }

        if (work.fundingRequestId) {
          const updatedRequest = await transaction.fundingRequest.updateMany({
            where: { id: work.fundingRequestId, status: "UNDER_SUPERVISOR_REVIEW" },
            data: {
              status: "COMPLETED",
              completedAt: decidedAt,
              lastStatusChangedAt: decidedAt,
            },
          });
          if (updatedRequest.count !== 1) {
            const error = new Error("A linked funding request is no longer awaiting supervisor review.");
            error.statusCode = 409;
            throw error;
          }
        } else {
          await transaction.paymentRequest.updateMany({
            where: { workId: work.id },
            data: { status: "APPROVED" },
          });
        }
      }

      return { employeeId, approvedCount: works.length };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error.code === "P2034") {
      const conflict = new Error("The employee's pending work changed while approving. Refresh and try again.");
      conflict.statusCode = 409;
      throw conflict;
    }
    throw error;
  }
}
