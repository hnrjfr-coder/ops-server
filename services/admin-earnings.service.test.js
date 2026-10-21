import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ADMIN_SUBSCRIPTION_EARNING_RATES,
  createAdminEarningWithdrawal,
  getAdminPendingSubscriptionsWhere,
  getAdminSubscriptionEarning,
  sumAdminSubscriptionEarnings,
} from "./admin-earnings.service.js";

test("admin subscription earnings use the approved per-account rates", () => {
  assert.deepEqual(ADMIN_SUBSCRIPTION_EARNING_RATES, {
    SWAGGZ: 8_000,
    METROFLEX: 8_000,
    NEILA: 6_500,
    MONETIZE: 8_000,
  });
  assert.equal(getAdminSubscriptionEarning(" neila "), 6_500);
  assert.equal(getAdminSubscriptionEarning("unknown account"), 0);
});

test("pending subscription records include only submitted subscription work awaiting supervisor review", () => {
  assert.deepEqual(getAdminPendingSubscriptionsWhere(), {
    status: "UNDER_REVIEW",
    accountCategory: "SUBSCRIPTION",
    fundingRequest: {
      is: {
        status: "UNDER_SUPERVISOR_REVIEW",
        accountCategory: "SUBSCRIPTION",
        accountName: { in: ["SWAGGZ", "METROFLEX", "NEILA", "MONETIZE"] },
      },
    },
  });
});

test("pending subscription earnings apply each account's fixed rate", () => {
  assert.equal(
    sumAdminSubscriptionEarnings([
      { accountName: "SWAGGZ", _count: { _all: 2 } },
      { accountName: "NEILA", _count: { _all: 3 } },
      { accountName: "OTHER", _count: { _all: 4 } },
    ]),
    35_500,
  );
});

test("admin withdrawals reject invalid amounts and empty or oversized purposes", async () => {
  await assert.rejects(
    createAdminEarningWithdrawal({ amount: 0, purpose: "Office supplies" }, "admin-1"),
    /valid withdrawal amount/,
  );
  await assert.rejects(
    createAdminEarningWithdrawal({ amount: "100", purpose: "Office supplies" }, "admin-1"),
    /valid withdrawal amount/,
  );
  await assert.rejects(
    createAdminEarningWithdrawal({ amount: 1, purpose: "   " }, "admin-1"),
    /withdrawal purpose/,
  );
  await assert.rejects(
    createAdminEarningWithdrawal({ amount: 1, purpose: "x".repeat(501) }, "admin-1"),
    /withdrawal purpose/,
  );
});
