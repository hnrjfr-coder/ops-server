import test from "node:test";
import assert from "node:assert/strict";
import {
  FUNDER_FUNDING_AMOUNTS,
  isAllowedFunderFundingAmount,
} from "./funder-funding-request.service.js";

test("funder requests allow only the four configured fixed amounts", () => {
  assert.deepEqual(FUNDER_FUNDING_AMOUNTS, [200_000, 500_000, 1_000_000, 2_000_000]);
  for (const amount of FUNDER_FUNDING_AMOUNTS) {
    assert.equal(isAllowedFunderFundingAmount(amount), true);
    assert.equal(isAllowedFunderFundingAmount(String(amount)), true);
  }
});

test("funder requests reject arbitrary, fractional, and unsafe amounts", () => {
  for (const amount of [0, 200_001, 500_000.5, -200_000, Number.MAX_SAFE_INTEGER + 1, "not-an-amount"]) {
    assert.equal(isAllowedFunderFundingAmount(amount), false);
  }
});
