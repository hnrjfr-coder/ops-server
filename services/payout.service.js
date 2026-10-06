import { prisma } from "../lib/prisma.js";
import { sendPayoutApprovalSms } from "./sms.service.js";

const WORKS_PER_PAYOUT = 20;
export const PAYOUT_PER_WORK = 3000;

const parsePagination = (input = {}) => {
  const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(input.pageSize, 10) || 20));
  return { page, pageSize, skip: (page - 1) * pageSize };
};

const paginatedResult = (items, total, page, pageSize) => ({
  items,
  pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) },
});

export function sumPaidPayoutAmounts(payoutRequests) {
  return payoutRequests
    .filter((payout) => payout.status === "PAID")
    .reduce((total, payout) => total + Number(payout.amount || 0), 0);
}

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

export function parseManualPayoutAmount(input) {
  const value = typeof input === "string" ? input.trim() : input;
  if (typeof value === "string" && !/^\d+$/.test(value)) {
    throw createError("Enter a whole-number payout amount greater than zero.", 400);
  }
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 2_147_483_647) {
    throw createError("Enter a whole-number payout amount greater than zero.", 400);
  }
  return amount;
}

const workSelection = {
  id: true,
  accountName: true,
  accountCategory: true,
  completedAt: true,
  approvedAt: true,
  status: true,
};

const payoutRequestDetails = {
  works: { select: workSelection, orderBy: { approvedAt: "asc" } },
};

const employeePayoutSelection = {
  id: true,
  amount: true,
  workCount: true,
  status: true,
  requestedAt: true,
  processedAt: true,
  adminNote: true,
  works: { select: workSelection, orderBy: { approvedAt: "asc" } },
};

const adminPayoutSelection = {
  ...employeePayoutSelection,
  employeeId: true,
  employeeName: true,
  employeePhone: true,
  payoutBankName: true,
  payoutAccountHolderName: true,
  payoutAccountNumber: true,
  reviewer: { select: { id: true, name: true, email: true } },
};

export async function createEmployeePayoutRequest(employeeId) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const employee = await transaction.user.findUnique({
        where: { id: employeeId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          accountType: true,
          status: true,
          payoutBankName: true,
          payoutAccountHolderName: true,
          payoutAccountNumber: true,
        },
      });
      if (!employee || employee.accountType !== "EMPLOYEE" || employee.status !== "ACTIVE") {
        throw createError("Active employee account was not found.", 404);
      }
      if (!employee.payoutBankName || !employee.payoutAccountHolderName || !employee.payoutAccountNumber) {
        throw createError("Complete your payout account details before requesting a payout.", 409);
      }

      const eligibleWorkWhere = {
        employeeId,
        status: "COMPLETED",
        approvedAt: { not: null },
        payoutRequestId: null,
      };
      const eligibleCount = await transaction.workSubmission.count({ where: eligibleWorkWhere });
      if (eligibleCount < WORKS_PER_PAYOUT) {
        throw createError(`A payout requires 20 confirmed works. ${eligibleCount} are currently eligible.`, 409);
      }

      const works = await transaction.workSubmission.findMany({
        where: eligibleWorkWhere,
        orderBy: [{ approvedAt: "asc" }, { id: "asc" }],
        take: WORKS_PER_PAYOUT,
        select: { id: true },
      });
      if (works.length !== WORKS_PER_PAYOUT) {
        throw createError("The confirmed works changed while preparing the payout. Please try again.", 409);
      }

      const payoutRequest = await transaction.payoutRequest.create({
        data: {
          amount: WORKS_PER_PAYOUT * PAYOUT_PER_WORK,
          workCount: WORKS_PER_PAYOUT,
          employeeId: employee.id,
          employeeName: employee.name,
          employeeEmail: employee.email,
          employeePhone: employee.phone,
          payoutBankName: employee.payoutBankName,
          payoutAccountHolderName: employee.payoutAccountHolderName,
          payoutAccountNumber: employee.payoutAccountNumber,
        },
      });

      const claimedWorks = await transaction.workSubmission.updateMany({
        where: { ...eligibleWorkWhere, id: { in: works.map((work) => work.id) } },
        data: { payoutRequestId: payoutRequest.id },
      });
      if (claimedWorks.count !== WORKS_PER_PAYOUT) {
        throw createError("Some confirmed works were already included in another payout request.", 409);
      }

      return transaction.payoutRequest.findUnique({
        where: { id: payoutRequest.id },
        include: payoutRequestDetails,
      });
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    if (error.code === "P2034") {
      throw createError("Confirmed works changed while preparing the payout. Please try again.", 409);
    }
    throw error;
  }
}

export async function listEmployeePayoutRequests(employeeId, input = {}) {
  const { page, pageSize, skip } = parsePagination(input);
  const where = { employeeId };
  const [items, total] = await Promise.all([
    prisma.payoutRequest.findMany({
      where,
      select: employeePayoutSelection,
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
      skip,
      take: pageSize,
    }),
    prisma.payoutRequest.count({ where }),
  ]);
  return paginatedResult(items, total, page, pageSize);
}

export async function getEmployeePayoutSummary(employeeId) {
  const confirmedWorkWhere = { employeeId, status: "COMPLETED", approvedAt: { not: null } };
  const [confirmedWorkCount, eligibleWorkCount, payoutGroups] = await Promise.all([
    prisma.workSubmission.count({ where: confirmedWorkWhere }),
    prisma.workSubmission.count({ where: { ...confirmedWorkWhere, payoutRequestId: null } }),
    prisma.payoutRequest.groupBy({
      by: ["status"],
      where: { employeeId },
      _count: { _all: true },
      _count: { _all: true },
      _sum: { amount: true, workCount: true },
    }),
  ]);
  const paidGroup = payoutGroups.find((group) => group.status === "PAID");
  const requestedWorkCount = payoutGroups.reduce((sum, group) => sum + (group._sum.workCount || 0), 0);
  return {
    payoutPerWork: PAYOUT_PER_WORK,
    worksPerPayout: WORKS_PER_PAYOUT,
    payoutAmount: PAYOUT_PER_WORK * WORKS_PER_PAYOUT,
    confirmedWorkCount,
    eligibleWorkCount,
    eligibleAmount: eligibleWorkCount * PAYOUT_PER_WORK,
    totalReceived: paidGroup?._sum.amount || 0,
    canRequestPayout: eligibleWorkCount >= WORKS_PER_PAYOUT,
    requestedWorkCount,
    payoutRequestCount: payoutGroups.reduce((sum, group) => sum + group._count._all, 0),
  };
}

export async function listAdminPayoutRequests(input = {}) {
  const { page, pageSize, skip } = parsePagination(input);
  const search = String(input.search || "").trim();
  const status = String(input.status || "").trim().toUpperCase();
  const dateRange = input.from || input.to ? getFundingDateRange(input) : null;
  const where = {
    ...(status && status !== "ALL" ? { status } : {}),
    ...(dateRange ? { requestedAt: { gte: dateRange.start, lt: dateRange.endExclusive } } : {}),
    ...(search ? {
      OR: [
        { id: { contains: search, mode: "insensitive" } },
        { employeeName: { contains: search, mode: "insensitive" } },
        { employeePhone: { contains: search, mode: "insensitive" } },
        { payoutBankName: { contains: search, mode: "insensitive" } },
      ],
    } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.payoutRequest.findMany({
      where,
      select: adminPayoutSelection,
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
      skip,
      take: pageSize,
    }),
    prisma.payoutRequest.count({ where }),
  ]);
  return paginatedResult(items, total, page, pageSize);
}

export async function searchAdminPayoutEmployees(input = {}) {
  const search = String(input.search || "").trim();
  if (search.length < 2) return { employees: [] };
  const employees = await prisma.user.findMany({
    where: {
      accountType: "EMPLOYEE",
      status: "ACTIVE",
      name: { contains: search, mode: "insensitive" },
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      payoutBankName: true,
      payoutAccountHolderName: true,
      payoutAccountNumber: true,
    },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    take: 10,
  });
  return { employees };
}

export async function createManualPayout(employeeId, adminId, input = {}) {
  if (!String(employeeId || "").trim()) throw createError("Select an employee for this payout.", 400);
  const amount = parseManualPayoutAmount(input.amount);
  const adminNote = String(input.adminNote || "").trim().slice(0, 1000);
  const processedAt = new Date();
  const payout = await prisma.$transaction(async (transaction) => {
    const employee = await transaction.user.findFirst({
      where: { id: employeeId, accountType: "EMPLOYEE", status: "ACTIVE" },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        payoutBankName: true,
        payoutAccountHolderName: true,
        payoutAccountNumber: true,
      },
    });
    if (!employee) throw createError("Active employee account was not found.", 404);
    if (!employee.payoutBankName || !employee.payoutAccountHolderName || !employee.payoutAccountNumber) {
      throw createError("The employee must complete their payout account details before a manual payout can be recorded.", 409);
    }

    const payoutRequest = await transaction.payoutRequest.create({
      data: {
        employeeId: employee.id,
        employeeName: employee.name,
        employeeEmail: employee.email,
        employeePhone: employee.phone,
        payoutBankName: employee.payoutBankName,
        payoutAccountHolderName: employee.payoutAccountHolderName,
        payoutAccountNumber: employee.payoutAccountNumber,
        amount,
        workCount: 0,
        status: "PAID",
        requestedAt: processedAt,
        processedAt,
        reviewerId: adminId,
        adminNote: adminNote
          ? `Manual payout recorded by admin. ${adminNote}`
          : "Manual payout recorded by admin.",
      },
      include: {
        ...payoutRequestDetails,
        reviewer: { select: { id: true, name: true, email: true } },
      },
    });
    return payoutRequest;
  });

  let smsNotification;
  try {
    smsNotification = await sendPayoutApprovalSms(payout);
  } catch {
    smsNotification = { status: "failed", reason: "unexpected_error" };
  }
  if (smsNotification.status !== "sent") {
    console.error("Manual payout SMS was not sent.", {
      payoutRequestId: payout.id,
      status: smsNotification.status,
      reason: smsNotification.reason,
    });
  }
  return { ...payout, smsNotification };
}

export async function decidePayoutRequest(requestId, reviewerId, decision, adminNote) {
  if (!["APPROVED", "REJECTED"].includes(decision)) {
    throw createError("Decision must be APPROVED or REJECTED.", 400);
  }

  const decidedRequest = await prisma.$transaction(async (transaction) => {
    const payoutRequest = await transaction.payoutRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        amount: true,
        workCount: true,
        status: true,
        _count: { select: { works: true } },
      },
    });
    if (!payoutRequest) throw createError("Payout request was not found.", 404);
    if (payoutRequest.status !== "PENDING") {
      throw createError("Only pending payout requests can be decided.", 409);
    }
    if (payoutRequest.workCount !== WORKS_PER_PAYOUT
      || payoutRequest._count.works !== WORKS_PER_PAYOUT
      || payoutRequest.amount !== WORKS_PER_PAYOUT * PAYOUT_PER_WORK) {
      throw createError("Payout request failed its work-bundle integrity check.", 409);
    }
    const confirmedWorkCount = await transaction.workSubmission.count({
      where: {
        payoutRequestId: requestId,
        status: "COMPLETED",
        approvedAt: { not: null },
      },
    });
    if (confirmedWorkCount !== WORKS_PER_PAYOUT) {
      throw createError("Payout request no longer contains 20 confirmed works.", 409);
    }

    const updated = await transaction.payoutRequest.updateMany({
      where: { id: requestId, status: "PENDING" },
      data: {
        status: decision === "APPROVED" ? "PAID" : "REJECTED",
        reviewerId,
        processedAt: new Date(),
        adminNote: String(adminNote || "").trim().slice(0, 1000) || null,
      },
    });
    if (updated.count !== 1) throw createError("Payout request was already decided.", 409);

    return transaction.payoutRequest.findUnique({
      where: { id: requestId },
      include: {
        ...payoutRequestDetails,
        reviewer: { select: { id: true, name: true, email: true } },
      },
    });
  });

  if (decision !== "APPROVED") return decidedRequest;

  let smsNotification;
  try {
    smsNotification = await sendPayoutApprovalSms(decidedRequest);
  } catch {
    smsNotification = { status: "failed", reason: "unexpected_error" };
  }
  if (smsNotification.status !== "sent") {
    console.error("Payout approval SMS was not sent.", {
      payoutRequestId: requestId,
      status: smsNotification.status,
      reason: smsNotification.reason,
    });
  }
  return { ...decidedRequest, smsNotification };
}
