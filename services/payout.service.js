import { prisma } from "../lib/prisma.js";

const WORKS_PER_PAYOUT = 20;
const PAYOUT_PER_WORK = 3000;

function createError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
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

export function listEmployeePayoutRequests(employeeId) {
  return prisma.payoutRequest.findMany({
    where: { employeeId },
    include: payoutRequestDetails,
    orderBy: { requestedAt: "desc" },
  });
}

export async function getEmployeePayoutSummary(employeeId) {
  const confirmedWorkWhere = { employeeId, status: "COMPLETED", approvedAt: { not: null } };
  const [confirmedWorkCount, eligibleWorkCount, payoutRequests] = await Promise.all([
    prisma.workSubmission.count({ where: confirmedWorkWhere }),
    prisma.workSubmission.count({ where: { ...confirmedWorkWhere, payoutRequestId: null } }),
    prisma.payoutRequest.findMany({
      where: { employeeId },
      select: { amount: true, workCount: true, status: true },
    }),
  ]);

  return {
    payoutPerWork: PAYOUT_PER_WORK,
    worksPerPayout: WORKS_PER_PAYOUT,
    payoutAmount: PAYOUT_PER_WORK * WORKS_PER_PAYOUT,
    confirmedWorkCount,
    eligibleWorkCount,
    eligibleAmount: eligibleWorkCount * PAYOUT_PER_WORK,
    canRequestPayout: eligibleWorkCount >= WORKS_PER_PAYOUT,
    requestedWorkCount: payoutRequests.reduce((sum, payout) => sum + payout.workCount, 0),
    payoutRequests,
  };
}

export function listAdminPayoutRequests() {
  return prisma.payoutRequest.findMany({
    include: {
      ...payoutRequestDetails,
      reviewer: { select: { id: true, name: true, email: true } },
    },
    orderBy: { requestedAt: "desc" },
  });
}

export async function decidePayoutRequest(requestId, reviewerId, decision, adminNote) {
  if (!["APPROVED", "REJECTED"].includes(decision)) {
    throw createError("Decision must be APPROVED or REJECTED.", 400);
  }

  return prisma.$transaction(async (transaction) => {
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
}
