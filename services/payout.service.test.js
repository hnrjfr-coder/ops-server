import assert from "node:assert/strict";
import test from "node:test";
import {
  getEmployeePayoutAmount,
  getAdminPayoutDateRange,
  summarizeAdminPayoutGroups,
  summarizeManualPayoutWorks,
} from "./payout.service.js";

test("employee payout amount allows any selected work count at or above the minimum", () => {
  assert.equal(getEmployeePayoutAmount(20), 60000);
  assert.equal(getEmployeePayoutAmount(25), 75000);
});

test("employee payout amount rejects counts below the minimum or exceeding the database integer limit", () => {
  assert.throws(() => getEmployeePayoutAmount(19), {
    message: "A payout requires at least 20 confirmed works.",
    statusCode: 400,
  });
  assert.throws(() => getEmployeePayoutAmount(1_000_000), {
    message: "The selected works exceed the maximum payout amount.",
    statusCode: 400,
  });
});

test("admin payout summary totals pending and paid requests and excludes rejected requests", () => {
  assert.deepEqual(summarizeAdminPayoutGroups([
    { status: "PENDING", _count: { _all: 2 }, _sum: { amount: 6000 } },
    { status: "PAID", _count: { _all: 3 }, _sum: { amount: 18000 } },
    { status: "REJECTED", _count: { _all: 1 }, _sum: { amount: 3000 } },
  ]), {
    pendingAmount: 6000,
    pendingCount: 2,
    approvedAmount: 18000,
    approvedCount: 3,
    totalAmount: 24000,
    totalCount: 5,
  });
});

test("admin payout summary returns zero totals when no eligible requests exist", () => {
  assert.deepEqual(summarizeAdminPayoutGroups([]), {
    pendingAmount: 0,
    pendingCount: 0,
    approvedAmount: 0,
    approvedCount: 0,
    totalAmount: 0,
    totalCount: 0,
  });
});

test("admin payout date range includes both selected dates", () => {
  assert.deepEqual(getAdminPayoutDateRange({ from: "2026-11-01", to: "2026-11-30" }), {
    gte: new Date("2026-11-01T00:00:00.000Z"),
    lt: new Date("2026-12-01T00:00:00.000Z"),
  });
  assert.equal(getAdminPayoutDateRange({}), null);
});

test("admin payout date range rejects partial, invalid, and reversed dates", () => {
  for (const input of [
    { from: "2026-11-01" },
    { from: "2026-02-30", to: "2026-03-02" },
    { from: "2026-11-30", to: "2026-11-01" },
  ]) {
    assert.throws(() => getAdminPayoutDateRange(input), { statusCode: 400 });
  }
});

test("manual payout records the admin-entered amount and includes every available approved work", () => {
  const works = Array.from({ length: 4 }, (_, index) => ({ id: `work-${index + 1}` }));
  assert.deepEqual(summarizeManualPayoutWorks(works, 17500), { workCount: 4, amount: 17500 });
});

test("manual payout requires at least one available approved work", () => {
  assert.throws(() => summarizeManualPayoutWorks([], 10000), {
    message: "No approved works are currently available for this employee's payout.",
    statusCode: 409,
  });
});

test("manual payout rejects invalid amounts outside the database integer range", () => {
  const works = [{ id: "work-1" }];
  for (const amount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER, 2_147_483_648, "3000"]) {
    assert.throws(() => summarizeManualPayoutWorks(works, amount), {
      message: "Enter a valid payout amount between 1 and 2,147,483,647 NGN.",
      statusCode: 400,
    });
  }
});
