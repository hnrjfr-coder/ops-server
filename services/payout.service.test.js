import assert from "node:assert/strict";
import test from "node:test";
import { summarizeManualPayoutWorks } from "./payout.service.js";

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
