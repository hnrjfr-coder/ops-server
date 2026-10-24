import test from "node:test";
import assert from "node:assert/strict";
import { createWorkSubmission, getPendingFirstPagePlan } from "./work.service.js";

test("work submission preserves an employee ID with a leading newline", async () => {
  const employeeId = "\n6f5350c3-d2a5-4617-b132-560915ee18dc";
  let lookedUpEmployeeId;
  const transaction = {
    user: {
      async findUnique({ where }) {
        lookedUpEmployeeId = where.id;
        return { accountType: "EMPLOYEE", status: "ACTIVE" };
      },
    },
    async $queryRaw() {},
    fundingRequest: {
      async findFirst() {
        return {
          status: "APPROVED",
          work: null,
          reports: [],
          refunds: [],
          accountName: "Monthly plan",
          accountCategory: "SUBSCRIPTION",
          supervisorId: "supervisor-1",
          supervisor: { id: "supervisor-1", status: "ACTIVE", accountType: "SUPERVISOR" },
          amount: 100,
        };
      },
      async updateMany() {
        return { count: 1 };
      },
    },
    workSubmission: {
      async create({ data }) {
        return data;
      },
    },
  };
  const database = {
    async $transaction(callback) {
      return callback(transaction);
    },
  };

  const work = await createWorkSubmission({
    employeeId,
    fundingRequestId: "funding-request-1",
  }, database);

  assert.equal(lookedUpEmployeeId, employeeId);
  assert.equal(work.employeeId, employeeId);
});

test("pending submissions occupy earlier pages before reviewed work", () => {
  assert.deepEqual(getPendingFirstPagePlan(0, 5, 7), {
    pendingTake: 5,
    reviewedSkip: 0,
    reviewedTake: 0,
  });
  assert.deepEqual(getPendingFirstPagePlan(5, 5, 7), {
    pendingTake: 2,
    reviewedSkip: 0,
    reviewedTake: 3,
  });
  assert.deepEqual(getPendingFirstPagePlan(10, 5, 7), {
    pendingTake: 0,
    reviewedSkip: 3,
    reviewedTake: 5,
  });
});

test("review-only pages retain their full page size when there are no pending submissions", () => {
  assert.deepEqual(getPendingFirstPagePlan(10, 5, 0), {
    pendingTake: 0,
    reviewedSkip: 10,
    reviewedTake: 5,
  });
});
