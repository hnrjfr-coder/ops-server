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
      async count() {
        return 0;
      },
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

test("work submission is blocked when four submissions are already awaiting supervisor review", async () => {
  let fundingLookupCalled = false;
  const transaction = {
    user: {
      async findUnique() {
        return { accountType: "EMPLOYEE", status: "ACTIVE" };
      },
    },
    async $queryRaw() {},
    workSubmission: {
      async count({ where }) {
        assert.deepEqual(where, { employeeId: "employee-1", status: "UNDER_REVIEW" });
        return 4;
      },
    },
    fundingRequest: {
      async findFirst() {
        fundingLookupCalled = true;
        throw new Error("Funding lookup should not run after the pending-work limit is reached.");
      },
    },
  };
  const database = {
    async $transaction(callback) {
      return callback(transaction);
    },
  };

  await assert.rejects(
    createWorkSubmission(
      { employeeId: "employee-1", fundingRequestId: "funding-request-1" },
      database,
    ),
    {
      statusCode: 409,
      message: "You can have at most 4 work submissions awaiting supervisor review at a time. Wait for a decision before submitting more work.",
    },
  );
  assert.equal(fundingLookupCalled, false);
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
