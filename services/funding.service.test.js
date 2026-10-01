import test from "node:test";
import assert from "node:assert/strict";
import { requestsSinceCompletedBatch } from "./funding.service.js";

const statuses = (...values) => values.map((status) => ({ status }));

test("four active requests fill the current cycle", () => {
  assert.equal(
    requestsSinceCompletedBatch(
      statuses("PENDING_FUNDER_APPROVAL", "APPROVED", "UNDER_SUPERVISOR_REVIEW", "PENDING_FUNDER_APPROVAL"),
    ),
    4,
  );
});

test("funder-rejected requests release their cycle slots", () => {
  assert.equal(
    requestsSinceCompletedBatch(statuses("PENDING_FUNDER_APPROVAL", "FUNDER_REJECTED", "APPROVED", "PENDING_FUNDER_APPROVAL")),
    3,
  );
});

test("supervisor-rejected work releases its cycle slot", () => {
  assert.equal(
    requestsSinceCompletedBatch(statuses("PENDING_FUNDER_APPROVAL", "SUPERVISOR_REJECTED", "APPROVED", "PENDING_FUNDER_APPROVAL")),
    3,
  );
});

test("four consecutive completed requests reset the cycle", () => {
  assert.equal(
    requestsSinceCompletedBatch(statuses("PENDING_FUNDER_APPROVAL", "COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED")),
    1,
  );
  assert.equal(
    requestsSinceCompletedBatch(statuses("COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED")),
    0,
  );
});

test("mixed request history preserves the active cycle count", () => {
  assert.equal(
    requestsSinceCompletedBatch(statuses("COMPLETED", "COMPLETED", "FUNDER_REJECTED", "PENDING_FUNDER_APPROVAL", "APPROVED")),
    4,
  );
});