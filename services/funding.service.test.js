import test from "node:test";
import assert from "node:assert/strict";
import { getFunderFundingDateRange, requestsSinceCompletedBatch } from "./funding.service.js";

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

test("funder date ranges use inclusive Africa/Lagos calendar days", () => {
  const range = getFunderFundingDateRange({ from: "2026-10-01", to: "2026-10-01" });
  assert.equal(range.start.toISOString(), "2026-09-30T23:00:00.000Z");
  assert.equal(range.endExclusive.toISOString(), "2026-10-01T23:00:00.000Z");
});

test("funder date ranges reject invalid or incomplete dates", () => {
  assert.throws(() => getFunderFundingDateRange({ from: "2026-10-01" }), { statusCode: 400 });
  assert.throws(() => getFunderFundingDateRange({ from: "2026-02-30", to: "2026-03-01" }), { statusCode: 400 });
  assert.throws(() => getFunderFundingDateRange({ from: "2026-10-02", to: "2026-10-01" }), { statusCode: 400 });
});