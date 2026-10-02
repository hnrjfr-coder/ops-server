import test from "node:test";
import assert from "node:assert/strict";
import {
  getFundingDateRange,
  hasUnsubmittedApprovedFundingRequest,
  requestsSinceCompletedBatch,
} from "./funding.service.js";
import { sumPaidPayoutAmounts } from "./payout.service.js";

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

test("approved funding blocks another request until work is submitted", () => {
  assert.equal(hasUnsubmittedApprovedFundingRequest([{ status: "APPROVED", work: null }]), true);
  assert.equal(hasUnsubmittedApprovedFundingRequest([{ status: "APPROVED" }]), true);
});

test("submitted work unlocks the next request before supervisor approval", () => {
  assert.equal(
    hasUnsubmittedApprovedFundingRequest([
      { status: "UNDER_SUPERVISOR_REVIEW", work: { id: "work-1" } },
    ]),
    false,
  );
  assert.equal(
    hasUnsubmittedApprovedFundingRequest([
      { status: "APPROVED", work: { id: "work-1" } },
    ]),
    false,
  );
});

test("pending or rejected funding does not trigger the submission gate", () => {
  assert.equal(
    hasUnsubmittedApprovedFundingRequest([
      { status: "PENDING_FUNDER_APPROVAL", work: null },
      { status: "FUNDER_REJECTED", work: null },
      { status: "SUPERVISOR_REJECTED", work: null },
    ]),
    false,
  );
});

test("funder date ranges use inclusive Africa/Lagos calendar days", () => {
  const range = getFundingDateRange({ from: "2026-10-01", to: "2026-10-01" });
  assert.equal(range.start.toISOString(), "2026-09-30T23:00:00.000Z");
  assert.equal(range.endExclusive.toISOString(), "2026-10-01T23:00:00.000Z");
});

test("funder date ranges reject invalid or incomplete dates", () => {
  assert.throws(() => getFundingDateRange({ from: "2026-10-01" }), { statusCode: 400 });
  assert.throws(() => getFundingDateRange({ from: "2026-02-30", to: "2026-03-01" }), { statusCode: 400 });
  assert.throws(() => getFundingDateRange({ from: "2026-10-02", to: "2026-10-01" }), { statusCode: 400 });
});

test("total received includes paid payouts only", () => {
  assert.equal(sumPaidPayoutAmounts([
    { status: "PAID", amount: 60000 },
    { status: "PENDING", amount: 30000 },
    { status: "REJECTED", amount: 12000 },
    { status: "APPROVED", amount: 15000 },
  ]), 60000);
});