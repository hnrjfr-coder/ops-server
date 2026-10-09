import assert from "node:assert/strict";
import test from "node:test";
import { summarizeManualPayoutWorks } from "./payout.service.js";

test("manual payout amount is calculated from every available approved work", () => {
  const works = Array.from({ length: 4 }, (_, index) => ({ id: `work-${index + 1}` }));
  assert.deepEqual(summarizeManualPayoutWorks(works), { workCount: 4, amount: 12000 });
});

test("manual payout requires at least one available approved work", () => {
  assert.throws(() => summarizeManualPayoutWorks([]), {
    message: "No approved works are currently available for this employee's payout.",
    statusCode: 409,
  });
});

test("manual payout rejects totals outside the database amount range", () => {
  const works = new Array(715828);
  assert.throws(() => summarizeManualPayoutWorks(works), {
    message: "Available approved earnings exceed the supported payout amount.",
    statusCode: 409,
  });
});
