import assert from "node:assert/strict";
import { test } from "node:test";
import { canArchiveFundingRecord } from "./admin.service.js";

test("admin can archive rejected funding only when no work submission is attached", () => {
  assert.equal(canArchiveFundingRecord({ status: "FUNDER_REJECTED", work: null }), true);
  assert.equal(canArchiveFundingRecord({ status: "FUNDER_REJECTED", work: { id: "work-1" } }), false);
  assert.equal(canArchiveFundingRecord({ status: "FUNDER_REJECTED", work: null, archivedAt: new Date() }), false);
});

test("archiving non-rejected funding requires an approved report or refund without work", () => {
  assert.equal(canArchiveFundingRecord({
    status: "APPROVED",
    work: null,
    reports: [{ status: "APPROVED" }],
    refunds: [],
  }), true);
  assert.equal(canArchiveFundingRecord({
    status: "APPROVED",
    work: { id: "work-1" },
    reports: [{ status: "APPROVED" }],
    refunds: [],
  }), false);
  assert.equal(canArchiveFundingRecord({ status: "PENDING_FUNDER_APPROVAL", work: null, reports: [], refunds: [] }), false);
});
