import assert from "node:assert/strict";
import test from "node:test";
import { parseManualPayoutAmount } from "./payout.service.js";

test("manual payout amount accepts positive whole-naira amounts", () => {
  assert.equal(parseManualPayoutAmount(15000), 15000);
  assert.equal(parseManualPayoutAmount("25000"), 25000);
});

test("manual payout amount rejects invalid and out-of-range values", () => {
  for (const amount of ["", "0", "-1", "100.5", "abc", "2147483648"]) {
    assert.throws(() => parseManualPayoutAmount(amount), {
      message: "Enter a whole-number payout amount greater than zero.",
      statusCode: 400,
    });
  }
});
