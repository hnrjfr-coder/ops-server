import test from "node:test";
import assert from "node:assert/strict";
import {
  getFundingDateRange,
  getActiveApprovedFundingWhere,
  getConfirmedFundingPeriodWhere,
  getFundingRequestBlockReason,
  hasUnsubmittedApprovedFundingRequest,
  requestsSinceCompletedBatch,
} from "./funding.service.js";
import { sumPaidPayoutAmounts } from "./payout.service.js";
import { normalizeFundingReportReason } from "./funding-report.service.js";
import { getInitialAccountStatus } from "./auth.service.js";
import { isFundingRequestEligibleForWork } from "./work.service.js";

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

test("pending refunds hold a cycle slot until the funder decides", () => {
  assert.equal(
    requestsSinceCompletedBatch(statuses("PENDING_FUNDER_APPROVAL", "APPROVED", "REFUND_PENDING", "REFUNDED", "PENDING_FUNDER_APPROVAL")),
    4,
  );
  assert.equal(
    getFundingRequestBlockReason([
      { status: "REFUND_PENDING", work: null },
      { status: "REFUNDED", work: null },
    ]),
    "AWAITING_REFUND_OR_REPORT_APPROVAL",
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

test("pending funder approval blocks another funding request", () => {
  assert.equal(
    getFundingRequestBlockReason([{ status: "PENDING_FUNDER_APPROVAL", work: null }]),
    "AWAITING_FUNDER_APPROVAL",
  );
});

test("approved funding blocks another request until work is submitted", () => {
  assert.equal(
    getFundingRequestBlockReason([{ status: "APPROVED", work: null }]),
    "AWAITING_WORK_SUBMISSION",
  );
});

test("submitted work clears the one-request gate before supervisor review", () => {
  assert.equal(
    getFundingRequestBlockReason([
      { status: "UNDER_SUPERVISOR_REVIEW", work: { id: "work-1" } },
    ]),
    null,
  );
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

test("rejected funding does not trigger the one-request gate", () => {
  assert.equal(
    getFundingRequestBlockReason([
      { status: "FUNDER_REJECTED", work: null },
      { status: "SUPERVISOR_REJECTED", work: null },
    ]),
    null,
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

test("confirmed funding period totals retain requests after later status changes", () => {
  const dateRange = getFundingDateRange({ from: "2026-10-01", to: "2026-10-01" });
  assert.deepEqual(getConfirmedFundingPeriodWhere("funder-1", dateRange), {
    funderId: "funder-1",
    approvedAt: { gte: dateRange.start, lt: dateRange.endExclusive },
  });
});

test("total received includes paid payouts only", () => {
  assert.equal(sumPaidPayoutAmounts([
    { status: "PAID", amount: 60000 },
    { status: "PENDING", amount: 30000 },
    { status: "REJECTED", amount: 12000 },
    { status: "APPROVED", amount: 15000 },
  ]), 60000);
});

test("funding report reason is required, trimmed, and length-limited", () => {
  assert.equal(normalizeFundingReportReason("  Funds used for the approved subscription.  "), "Funds used for the approved subscription.");
  assert.throws(() => normalizeFundingReportReason("  "), { statusCode: 400 });
  assert.throws(() => normalizeFundingReportReason("r".repeat(2001)), { statusCode: 400 });
});

test("new employees require admin approval while other account types stay active", () => {
  assert.equal(getInitialAccountStatus("EMPLOYEE"), "PENDING_ADMIN_APPROVAL");
  assert.equal(getInitialAccountStatus("SUPERVISOR"), "ACTIVE");
  assert.equal(getInitialAccountStatus("FUNDER"), "ACTIVE");
});

test("reported or refunded funding is not eligible for work submission", () => {
  assert.equal(isFundingRequestEligibleForWork({ status: "APPROVED", work: null, reports: [] }), true);
  assert.equal(isFundingRequestEligibleForWork({ status: "APPROVED", work: null, reports: [{ id: "report-1" }] }), false);
  assert.equal(isFundingRequestEligibleForWork({ status: "APPROVED", work: null, refunds: [{ id: "refund-1", status: "REJECTED" }] }), false);
  assert.equal(isFundingRequestEligibleForWork({ status: "REFUNDED", work: null, reports: [] }), false);
  assert.equal(isFundingRequestEligibleForWork({ status: "REFUND_PENDING", work: null, reports: [] }), false);
});

test("approved funding totals exclude all reported or refunded requests", () => {
  assert.deepEqual(getActiveApprovedFundingWhere({ employeeId: "employee-1" }), {
    employeeId: "employee-1",
    status: "APPROVED",
    reports: { none: {} },
    refunds: { none: {} },
  });
});

test("pending refunds or reports block new funding; decisions release their slots", () => {
  const activeRequests = [
    { status: "APPROVED" },
    { status: "PENDING_FUNDER_APPROVAL" },
    { status: "APPROVED", refunds: [{ status: "REJECTED" }] },
    { status: "APPROVED", reports: [{ status: "PENDING_FUNDER_APPROVAL" }] },
    { status: "APPROVED", reports: [{ status: "APPROVED" }] },
  ];
  assert.equal(requestsSinceCompletedBatch(activeRequests), 3);
  assert.equal(getFundingRequestBlockReason(activeRequests), "AWAITING_FUNDER_APPROVAL");
  assert.equal(getFundingRequestBlockReason([
    { status: "APPROVED", refunds: [{ status: "PENDING_FUNDER_APPROVAL" }] },
  ]), "AWAITING_REFUND_OR_REPORT_APPROVAL");
  assert.equal(getFundingRequestBlockReason([
    { status: "APPROVED", refunds: [{ status: "REJECTED" }] },
    { status: "APPROVED", reports: [{ status: "REJECTED" }] },
  ]), null);
});