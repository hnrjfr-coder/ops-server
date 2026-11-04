import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canArchiveFundingRecord,
  getAdminStaffWhere,
  getStaffPerformanceMonthRange,
  partitionFundingPurgeCandidates,
} from "./admin.service.js";

test("staff performance month uses Africa/Lagos month boundaries", () => {
  const range = getStaffPerformanceMonthRange("2026-11");
  assert.equal(range.month, "2026-11");
  assert.equal(range.from.toISOString(), "2026-10-31T23:00:00.000Z");
  assert.equal(range.to.toISOString(), "2026-11-30T23:00:00.000Z");
});

test("staff performance month rejects malformed calendar months", () => {
  for (const month of ["2026-00", "2026-13", "2026-2", "2026-11-01"]) {
    assert.throws(
      () => getStaffPerformanceMonthRange(month),
      { message: "performanceMonth must use YYYY-MM format.", statusCode: 400 },
    );
  }
});

test("staff performance mode only returns active employees with at most four submissions", () => {
  assert.deepEqual(getAdminStaffWhere({
    status: "PENDING_ADMIN_APPROVAL",
    performanceMode: true,
    overLimitEmployeeIds: ["employee-over-limit"],
  }), {
    accountType: "EMPLOYEE",
    status: "ACTIVE",
    id: { notIn: ["employee-over-limit"] },
  });
});

test("normal staff listing retains its selected status filter", () => {
  assert.deepEqual(getAdminStaffWhere({ status: "PENDING_ADMIN_APPROVAL" }), {
    accountType: "EMPLOYEE",
    status: "PENDING_ADMIN_APPROVAL",
  });
});

test("rejected funding cleanup skips records with attached work", () => {
  const result = partitionFundingPurgeCandidates([
    { id: "rejected-1", work: null, refunds: [] },
    { id: "rejected-2", work: { id: "work-1" }, refunds: [] },
    { id: "rejected-3", work: null, refunds: [{ id: "refund-1" }] },
  ], { preserveRefunds: true });
  assert.deepEqual(result, {
    deletable: [{ id: "rejected-1", work: null, refunds: [] }],
    skippedCount: 2,
  });
});

test("refunded funding cleanup skips work already assigned to a payout bundle", () => {
  const result = partitionFundingPurgeCandidates([
    { id: "refunded-1", work: { id: "work-1", payoutRequestId: null } },
    { id: "refunded-2", work: { id: "work-2", payoutRequestId: "payout-1" } },
    { id: "refunded-3", work: null },
  ], { preservePayoutBundles: true });
  assert.deepEqual(result, {
    deletable: [
      { id: "refunded-1", work: { id: "work-1", payoutRequestId: null } },
      { id: "refunded-3", work: null },
    ],
    skippedCount: 1,
  });
});

test("admin can archive rejected funding only when no work submission is attached", () => {
  assert.equal(canArchiveFundingRecord({ status: "FUNDER_REJECTED", work: null }), true);
  assert.equal(canArchiveFundingRecord({ status: "FUNDER_REJECTED", work: { id: "work-1" } }), false);
  assert.equal(canArchiveFundingRecord({ status: "FUNDER_REJECTED", work: null, archivedAt: new Date() }), false);
});

test("admin can archive refunded funding even when linked work must be retained", () => {
  assert.equal(canArchiveFundingRecord({ status: "REFUNDED", work: { id: "work-1" } }), true);
  assert.equal(canArchiveFundingRecord({ status: "REFUNDED", work: null, archivedAt: new Date() }), false);
});

test("archiving non-rejected funding requires an approved refund without work", () => {
  assert.equal(canArchiveFundingRecord({
    status: "APPROVED",
    work: null,
    refunds: [{ status: "APPROVED" }],
  }), true);
  assert.equal(canArchiveFundingRecord({
    status: "APPROVED",
    work: { id: "work-1" },
    refunds: [{ status: "APPROVED" }],
  }), false);
  assert.equal(canArchiveFundingRecord({ status: "PENDING_FUNDER_APPROVAL", work: null, refunds: [] }), false);
});
