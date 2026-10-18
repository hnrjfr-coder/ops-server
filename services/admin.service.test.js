import assert from "node:assert/strict";
import { test } from "node:test";
import { canDeleteFundingRecord } from "./admin.service.js";

test("admin can delete rejected funding only when no work submission is attached", () => {
  assert.equal(canDeleteFundingRecord({ status: "FUNDER_REJECTED", work: null }), true);
  assert.equal(canDeleteFundingRecord({ status: "FUNDER_REJECTED", work: { id: "work-1" } }), false);
});

test("existing deletion rule still requires an approved report or refund without work", () => {
  assert.equal(canDeleteFundingRecord({
    status: "APPROVED",
    work: null,
    reports: [{ status: "APPROVED" }],
    refunds: [],
  }), true);
  assert.equal(canDeleteFundingRecord({
    status: "APPROVED",
    work: { id: "work-1" },
    reports: [{ status: "APPROVED" }],
    refunds: [],
  }), false);
  assert.equal(canDeleteFundingRecord({ status: "PENDING_FUNDER_APPROVAL", work: null, reports: [], refunds: [] }), false);
});
