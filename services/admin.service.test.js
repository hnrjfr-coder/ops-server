import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canArchiveFundingRecord,
  partitionFundingPurgeCandidates,
} from "./admin.service.js";

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
