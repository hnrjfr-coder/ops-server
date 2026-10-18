import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ADMIN_SUBSCRIPTION_EARNING_RATES,
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
