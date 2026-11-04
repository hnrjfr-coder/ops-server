import test from "node:test";
import assert from "node:assert/strict";
import { getUnusedFundingWhere } from "./analytics.service.js";

test("unused funding uses the same eligibility rule as work submission", () => {
  assert.deepEqual(getUnusedFundingWhere(), {
    status: "APPROVED",
    refunds: { none: {} },
    work: null,
  });
});
