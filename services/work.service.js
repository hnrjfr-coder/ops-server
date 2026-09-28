import { prisma } from "../lib/prisma.js";

const parseAmount = (value) => {
  const amount = Number(value);
  return Number.isInteger(amount) && amount > 0 ? amount : null;
};

export async function createWorkSubmission(input) {
  const employeeId = String(input.employeeId || "").trim();
  const title = String(input.title || "").trim();
  const description = String(input.description || "").trim();
  const category = String(input.category || "").trim();
  const completedAt = new Date(input.completedAt);
  const amount = parseAmount(input.amount);
  const notes = String(input.notes || "").trim() || null;

  if (!employeeId || !title || !description || !category || Number.isNaN(completedAt.getTime()) || !amount) {
    const error = new Error("employeeId, title, description, category, completedAt, and a positive amount are required.");
    error.statusCode = 400;
    throw error;
  }

  return prisma.$transaction(async (transaction) => {
    const employee = await transaction.user.findUnique({ where: { id: employeeId } });
    if (!employee) {
      const error = new Error("Employee account was not found.");
      error.statusCode = 404;
      throw error;
    }
    if (!employee.managerId) {
      const error = new Error("This employee does not have a supervisor assigned.");
      error.statusCode = 409;
      throw error;
    }

    return transaction.workSubmission.create({
      data: {
        employeeId,
        title,
        description,
        category,
        completedAt,
        amount,
        notes,
        supervisorId: employee.managerId,
        status: "UNDER_REVIEW",
        payment: { create: { employeeId, supervisorId: employee.managerId, amount, notes, status: "PENDING" } },
      },
      include: { payment: true },
    });
  });
}

export function listWorkSubmissions(employeeId) {
  return prisma.workSubmission.findMany({
    where: employeeId ? { employeeId } : undefined,
    include: { payment: true },
    orderBy: { submittedAt: "desc" },
  });
}

export function listPaymentRequests(employeeId) {
  return prisma.paymentRequest.findMany({
    where: employeeId ? { employeeId } : undefined,
    include: { work: true },
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
    include: { employee: true, payment: true },
    orderBy: { submittedAt: "desc" },
  });
  return {
    totals: {
      submitted: works.length,
      underReview: works.filter((work) => work.status === "UNDER_REVIEW").length,
      approved: works.filter((work) => ["APPROVED", "PAID"].includes(work.status)).length,
      pendingPayouts: works.filter((work) => work.payment?.status === "PENDING").length,
    },
    works,
  };
}

export async function updateSupervisedWorkStatus(supervisorId, workId, status) {
  const allowedStatuses = ["UNDER_REVIEW", "APPROVED", "REJECTED"];
  if (!allowedStatuses.includes(status)) {
    const error = new Error("Invalid work status.");
    error.statusCode = 400;
    throw error;
  }
  const work = await prisma.workSubmission.findFirst({
    where: { id: workId, supervisorId },
  });
  if (!work) {
    const error = new Error("Work submission was not found in your supervision list.");
    error.statusCode = 404;
    throw error;
  }
  return prisma.workSubmission.update({
    where: { id: workId },
    data: { status, approvedAt: status === "APPROVED" ? new Date() : work.approvedAt },
    include: { payment: true, employee: true },
  });
}
