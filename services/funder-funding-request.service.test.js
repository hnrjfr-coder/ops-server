import test from "node:test";
import assert from "node:assert/strict";
import {
  FUNDER_FUNDING_AMOUNTS,
  isAllowedFunderFundingAmount,
  listAdminFunderFundingRequests,
} from "./funder-funding-request.service.js";
import { prisma } from "../lib/prisma.js";

test("funder requests allow only the four configured fixed amounts", () => {
  assert.deepEqual(FUNDER_FUNDING_AMOUNTS, [200_000, 500_000, 1_000_000, 2_000_000]);
  for (const amount of FUNDER_FUNDING_AMOUNTS) {
    assert.equal(isAllowedFunderFundingAmount(amount), true);
    assert.equal(isAllowedFunderFundingAmount(String(amount)), true);
  }
});

test("funder requests reject arbitrary, fractional, and unsafe amounts", () => {
  for (const amount of [0, 200_001, 500_000.5, -200_000, Number.MAX_SAFE_INTEGER + 1, "not-an-amount"]) {
    assert.equal(isAllowedFunderFundingAmount(amount), false);
  }
});

test("admin funder requests apply the selected current-month date range", async (t) => {
  const originalMethods = {
    findMany: prisma.funderFundingRequest.findMany,
    count: prisma.funderFundingRequest.count,
    groupBy: prisma.funderFundingRequest.groupBy,
  };
  t.after(() => {
    prisma.funderFundingRequest.findMany = originalMethods.findMany;
    prisma.funderFundingRequest.count = originalMethods.count;
    prisma.funderFundingRequest.groupBy = originalMethods.groupBy;
  });

  const capturedWhere = [];
  prisma.funderFundingRequest.findMany = async ({ where }) => {
    capturedWhere.push(where);
    return [];
  };
  prisma.funderFundingRequest.count = async ({ where }) => {
    capturedWhere.push(where);
    return 0;
  };
  prisma.funderFundingRequest.groupBy = async ({ where }) => {
    capturedWhere.push(where);
    return [];
  };

  await listAdminFunderFundingRequests({
    from: "2026-11-01",
    to: "2026-11-30",
  });

  const expectedDateRange = {
    gte: new Date("2026-11-01T00:00:00.000Z"),
    lt: new Date("2026-12-01T00:00:00.000Z"),
  };
  assert.equal(capturedWhere.length, 3);
  assert.ok(capturedWhere.every((where) => where.requestedAt));
  assert.ok(
    capturedWhere.every(
      (where) =>
        where.requestedAt.gte.getTime() === expectedDateRange.gte.getTime() &&
        where.requestedAt.lt.getTime() === expectedDateRange.lt.getTime(),
    ),
  );
});
