import test from "node:test";
import assert from "node:assert/strict";
import { getPendingFirstPagePlan } from "./work.service.js";

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
