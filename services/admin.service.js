import { prisma } from "../lib/prisma.js";
import { PAYOUT_PER_WORK } from "./payout.service.js";

const employeeWhere = { accountType: "EMPLOYEE" };

export function getStaffPerformanceMonthRange(monthInput) {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(monthInput || ""));
  const year = Number(match?.[1]);
  const month = Number(match?.[2]);
  if (!match || year < 1000) {
    const error = new Error("performanceMonth must use YYYY-MM format.");
    error.statusCode = 400;
    throw error;
  }

  const lagosOffsetMs = 60 * 60 * 1000;
  return {
    month: `${match[1]}-${match[2]}`,
    from: new Date(Date.UTC(year, month - 1, 1) - lagosOffsetMs),
    to: new Date(Date.UTC(year, month, 1) - lagosOffsetMs),
  };
}

const parsePagination = (input = {}) => {
  const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(input.pageSize, 10) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize };
};

export async function getAdminOverview() {
  const [employeeCount, activeEmployeeCount, pendingPayoutCount, pendingPayouts, completedWorkCount, recentPayouts] = await Promise.all([
    prisma.user.count({ where: employeeWhere }),
    prisma.user.count({ where: { ...employeeWhere, status: "ACTIVE" } }),
    prisma.payoutRequest.count({ where: { status: "PENDING" } }),
    prisma.payoutRequest.aggregate({ where: { status: "PENDING" }, _sum: { amount: true } }),
    prisma.workSubmission.count({ where: { status: "COMPLETED", approvedAt: { not: null } } }),
    prisma.payoutRequest.findMany({
      take: 5,
      orderBy: { requestedAt: "desc" },
      select: {
        id: true,
        employeeId: true,
        employeeName: true,
        amount: true,
        workCount: true,
        status: true,
        requestedAt: true,
      },
    }),
  ]);

  return {
    employeeCount,
    activeEmployeeCount,
    pendingPayoutCount,
    pendingPayoutAmount: pendingPayouts._sum.amount || 0,
    completedWorkCount,
    recentPayouts,
  };
}

export async function getAdminSignupNotifications() {
  const pendingEmployeeSignupCount = await prisma.user.count({
    where: { accountType: "EMPLOYEE", status: "PENDING_ADMIN_APPROVAL" },
  });
  return { pendingEmployeeSignupCount };
}

export async function listAdminStaff(input = {}) {
  const { page, pageSize, skip } = parsePagination(input);
  const search = String(input.search || "").trim();
  const status = String(input.status || "").trim().toUpperCase();
  const performanceRange = input.performanceMonth
    ? getStaffPerformanceMonthRange(input.performanceMonth)
    : null;
  let performanceCounts = new Map();
  const where = {
    ...employeeWhere,
    ...(status && status !== "ALL" ? { status } : {}),
    ...(search ? {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
        { manager: { is: { name: { contains: search, mode: "insensitive" } } } },
      ],
    } : {}),
  };
  if (performanceRange) {
    const counts = await prisma.workSubmission.groupBy({
      by: ["employeeId"],
      where: { submittedAt: { gte: performanceRange.from, lt: performanceRange.to } },
      _count: { _all: true },
    });
    performanceCounts = new Map(counts.map((row) => [row.employeeId, row._count._all]));
    const overLimitEmployeeIds = counts
      .filter((row) => row._count._all > 4)
      .map((row) => row.employeeId);
    if (overLimitEmployeeIds.length > 0) {
      where.id = { notIn: overLimitEmployeeIds };
    }
  }
  const [employees, total, statusGroups] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: [{ name: "asc" }, { email: "asc" }, { id: "asc" }],
      skip,
      take: pageSize,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        status: true,
        createdAt: true,
        adminApprovedAt: true,
        adminApprover: { select: { id: true, name: true } },
        manager: { select: { id: true, name: true } },
        _count: { select: { work: true, payoutRequests: true } },
      },
    }),
    prisma.user.count({ where }),
    prisma.user.groupBy({ by: ["status"], where: employeeWhere, _count: { _all: true } }),
  ]);
  const countsByStatus = Object.fromEntries(statusGroups.map((group) => [group.status, group._count._all]));
  const employeeCount = Object.values(countsByStatus).reduce((sum, count) => sum + count, 0);
  const activeEmployeeCount = countsByStatus.ACTIVE || 0;
  const pendingApprovalCount = countsByStatus.PENDING_ADMIN_APPROVAL || 0;

  return {
    employees: performanceRange
      ? employees.map((employee) => ({
          ...employee,
          monthlySubmittedWorkCount: performanceCounts.get(employee.id) || 0,
        }))
      : employees,
    ...(performanceRange ? { performanceMonth: performanceRange.month } : {}),
    employeeCount,
    activeEmployeeCount,
    pendingApprovalCount,
    statuses: statusGroups.map(({ status: employeeStatus }) => employeeStatus),
    pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) },
  };
}

export function canArchiveFundingRecord(record) {
  if (!record || record.archivedAt) return false;
  if (record.status === "REFUNDED") return true;
  if (record.status === "FUNDER_REJECTED") return record.work === null;
  return Boolean(record.work === null && record.refunds?.some((refund) => refund.status === "APPROVED"));
}

export async function archiveAdminFundingRecord(fundingRequestId, adminId) {
  return prisma.$transaction(async (transaction) => {
    const funding = await transaction.fundingRequest.findUnique({
      where: { id: fundingRequestId },
      select: {
        id: true,
        status: true,
        archivedAt: true,
        work: { select: { id: true } },
        refunds: { select: { id: true, status: true } },
      },
    });
    if (!funding) {
      const error = new Error("Funding request was not found.");
      error.statusCode = 404;
      throw error;
    }
    if (!canArchiveFundingRecord(funding)) {
      const error = new Error("Only rejected funding requests without work, or funding requests with an approved refund and no work, can be archived.");
      error.statusCode = 409;
      throw error;
    }

    const archived = await transaction.fundingRequest.updateMany({
      where: { id: fundingRequestId, archivedAt: null },
      data: { archivedAt: new Date(), archivedById: adminId },
    });
    if (archived.count !== 1) {
      const error = new Error("This funding request has already been archived.");
      error.statusCode = 409;
      throw error;
    }
    return transaction.fundingRequest.findUnique({
      where: { id: fundingRequestId },
      select: { id: true, archivedAt: true, archivedById: true },
    });
  });
}

export function partitionFundingPurgeCandidates(
  requests,
  { preservePayoutBundles = false, preserveRefunds = false } = {},
) {
  const deletable = requests.filter((request) => {
    if (!Object.hasOwn(request, "work")) return false;
    if (preserveRefunds && (!Array.isArray(request.refunds) || request.refunds.length > 0)) return false;
    if (request.work === null) return true;
    if (!preservePayoutBundles || !request.work) return false;
    return request.work.payoutRequestId === null;
  });
  return {
    deletable,
    skippedCount: requests.length - deletable.length,
  };
}

async function deleteFundingHistory(transaction, requests, { deleteRefunds = false, deleteWork = false } = {}) {
  const ids = requests.map((request) => request.id);
  if (ids.length === 0) return { deletedCount: 0 };

  await transaction.$queryRaw`SELECT set_config('ops.allow_funding_history_delete', 'on', true)`;
  if (deleteRefunds) {
    await transaction.refundRequest.deleteMany({ where: { fundingRequestId: { in: ids } } });
  }
  if (deleteWork) {
    await transaction.workSubmission.deleteMany({ where: { fundingRequestId: { in: ids } } });
  }
  const result = await transaction.fundingRequest.deleteMany({ where: { id: { in: ids } } });
  if (result.count !== ids.length) {
    const error = new Error("Funding records changed during cleanup. No records were deleted; refresh and try again.");
    error.statusCode = 409;
    throw error;
  }
  return { deletedCount: result.count };
}

export async function purgeRejectedFundingRequests() {
  return prisma.$transaction(async (transaction) => {
    const lockedRequests = await transaction.$queryRaw`
      SELECT "id" FROM "ops"."FundingRequest"
      WHERE "status" = 'FUNDER_REJECTED'
      FOR UPDATE
    `;
    const requests = lockedRequests.length
      ? await transaction.fundingRequest.findMany({
        where: { id: { in: lockedRequests.map((request) => request.id) }, status: "FUNDER_REJECTED" },
        select: {
          id: true,
          work: { select: { id: true } },
          refunds: { select: { id: true } },
        },
      })
      : [];
    const { deletable, skippedCount } = partitionFundingPurgeCandidates(requests, { preserveRefunds: true });
    const { deletedCount } = await deleteFundingHistory(transaction, deletable);
    return { deletedCount, skippedCount };
  }, { isolationLevel: "Serializable" });
}

export async function purgeApprovedRefundedFundingRequests() {
  return prisma.$transaction(async (transaction) => {
    const lockedRequests = await transaction.$queryRaw`
      SELECT funding."id"
      FROM "ops"."FundingRequest" AS funding
      WHERE funding."status" = 'REFUNDED'
        AND EXISTS (
          SELECT 1 FROM "ops"."RefundRequest" AS refund
          WHERE refund."fundingRequestId" = funding."id"
            AND refund."status" = 'APPROVED'
        )
      FOR UPDATE OF funding
    `;
    const requests = lockedRequests.length
      ? await transaction.fundingRequest.findMany({
        where: {
          id: { in: lockedRequests.map((request) => request.id) },
          status: "REFUNDED",
          refunds: { some: { status: "APPROVED" } },
        },
        select: { id: true, work: { select: { id: true, payoutRequestId: true } } },
      })
      : [];
    const { deletable, skippedCount } = partitionFundingPurgeCandidates(requests, {
      preservePayoutBundles: true,
    });
    const { deletedCount } = await deleteFundingHistory(transaction, deletable, {
      deleteRefunds: true,
      deleteWork: true,
    });
    return { deletedCount, skippedCount };
  }, { isolationLevel: "Serializable" });
}

export async function approveEmployeeAccount(employeeId, adminId) {
  const result = await prisma.user.updateMany({
    where: { id: employeeId, accountType: "EMPLOYEE", status: "PENDING_ADMIN_APPROVAL" },
    data: { status: "ACTIVE", adminApproverId: adminId, adminApprovedAt: new Date() },
  });
  if (result.count !== 1) {
    const error = new Error("Pending employee account was not found.");
    error.statusCode = 404;
    throw error;
  }
  return prisma.user.findUnique({
    where: { id: employeeId },
    select: { id: true, name: true, email: true, status: true, adminApprovedAt: true, adminApproverId: true },
  });
}

export async function getAdminStaffDetails(staffId) {
  const employee = await prisma.user.findFirst({
    where: { id: staffId, accountType: "EMPLOYEE" },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,
      createdAt: true,
      manager: { select: { id: true, name: true, email: true } },
      work: {
        take: 10,
        orderBy: { submittedAt: "desc" },
        select: {
          id: true,
          accountName: true,
          accountCategory: true,
          amount: true,
          status: true,
          completedAt: true,
          submittedAt: true,
          approvedAt: true,
        },
      },
      payoutRequests: {
        take: 5,
        orderBy: { requestedAt: "desc" },
        select: {
          id: true,
          amount: true,
          workCount: true,
          status: true,
          requestedAt: true,
          processedAt: true,
          adminNote: true,
        },
      },
      _count: { select: { work: true, payoutRequests: true } },
    },
  });

  if (!employee) {
    const error = new Error("Employee was not found.");
    error.statusCode = 404;
    throw error;
  }

  const [completedWorkCount, awaitingReviewWorkCount] = await Promise.all([
    prisma.workSubmission.count({ where: { employeeId: staffId, status: "COMPLETED", approvedAt: { not: null } } }),
    prisma.workSubmission.count({ where: { employeeId: staffId, status: "UNDER_REVIEW" } }),
  ]);

  return {
    ...employee,
    workSummary: {
      total: employee._count.work,
      completed: completedWorkCount,
      confirmedEarnings: completedWorkCount * PAYOUT_PER_WORK,
      awaitingReview: awaitingReviewWorkCount,
    },
    payoutRequestCount: employee._count.payoutRequests,
  };
}