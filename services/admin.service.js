import { prisma } from "../lib/prisma.js";
import { PAYOUT_PER_WORK } from "./payout.service.js";

const employeeWhere = { accountType: "EMPLOYEE" };

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

export async function listAdminStaff() {
  const [employees, employeeCount, activeEmployeeCount] = await Promise.all([
    prisma.user.findMany({
      where: employeeWhere,
      orderBy: [{ name: "asc" }, { email: "asc" }],
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
    prisma.user.count({ where: employeeWhere }),
    prisma.user.count({ where: { ...employeeWhere, status: "ACTIVE" } }),
  ]);

  return { employees, employeeCount, activeEmployeeCount };
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