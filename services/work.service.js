import { prisma } from "../lib/prisma.js";

export async function createWorkSubmission(input) {
  const employeeId = String(input.employeeId || "").trim();
  const fundingRequestId = String(input.fundingRequestId || "").trim();
  const accountName = String(input.accountName || "").trim();
  const accountCategory = String(input.accountCategory || "").trim().toUpperCase();
  const completedAt = new Date(input.completedAt);
  const notes = String(input.notes || "").trim() || null;

  if (!employeeId || !fundingRequestId || !accountName || !["SUBSCRIPTION", "RENEWAL"].includes(accountCategory) || Number.isNaN(completedAt.getTime())) {
    const error = new Error("fundingRequestId, accountName, a valid accountCategory, and completedAt are required.");
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
    const fundingRequest = await transaction.fundingRequest.findFirst({
      where: { id: fundingRequestId, employeeId, status: "APPROVED", work: null },
      include: { supervisor: { select: { id: true, status: true, accountType: true } } },
    });
    if (!fundingRequest) {
      const error = new Error("An approved funding request available for work submission was not found.");
      error.statusCode = 409;
      throw error;
    }
    if (!fundingRequest.supervisor || fundingRequest.supervisor.status !== "ACTIVE" || fundingRequest.supervisor.accountType !== "SUPERVISOR") {
      const error = new Error("The supervisor assigned to this funding request is not active.");
      error.statusCode = 409;
      throw error;
    }

    const claimedRequest = await transaction.fundingRequest.updateMany({
      where: { id: fundingRequestId, employeeId, status: "APPROVED" },
      data: { status: "UNDER_SUPERVISOR_REVIEW" },
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
        completedAt,
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
      fundingRequest: true,
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

export async function getSupervisorWorks(supervisorId) {
  const works = await prisma.workSubmission.findMany({
    where: { supervisorId },
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
      fundingRequest: true,
    },
    orderBy: { submittedAt: "desc" },
  });
  return {
    totals: {
      submitted: works.length,
      underReview: works.filter((work) => work.status === "UNDER_REVIEW").length,
      approved: works.filter((work) => ["APPROVED", "COMPLETED", "PAID"].includes(work.status)).length,
      pendingPayouts: works.filter((work) => work.payment?.status === "PENDING").length,
    },
    works,
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
      department: true,
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
      data: { status: workStatus, approvedAt: status === "APPROVED" ? new Date() : null },
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
          completedAt: status === "APPROVED" ? new Date() : null,
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
