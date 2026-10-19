import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ADMIN_SUBSCRIPTION_EARNING_RATES,
  getAdminPendingSubscriptionsWhere,
  getAdminSubscriptionEarning,
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
