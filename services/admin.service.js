import { prisma } from "../lib/prisma.js";
import { PAYOUT_PER_WORK } from "./payout.service.js";

const employeeWhere = { accountType: "EMPLOYEE" };

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
    employees,
    employeeCount,
    activeEmployeeCount,
    pendingApprovalCount,
    statuses: statusGroups.map(({ status: employeeStatus }) => employeeStatus),
    pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) },
  };
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