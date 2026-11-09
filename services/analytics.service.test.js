import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  getAdminAnalytics,
  getUnusedFundingWhere,
  listAdminAnalyticsRecords,
} from "./analytics.service.js";

test("unused funding uses the same eligibility rule as work submission", () => {
  assert.deepEqual(getUnusedFundingWhere(), {
    status: "APPROVED",
    refunds: { none: {} },
    work: null,
  });
});

test("all-time analytics aggregates records without applying a date range", async (t) => {
  const originalMethods = {
    userCount: prisma.user.count,
    fundingAggregate: prisma.fundingRequest.aggregate,
    payoutAggregate: prisma.payoutRequest.aggregate,
    refundAggregate: prisma.refundRequest.aggregate,
    queryRaw: prisma.$queryRaw,
  };
  t.after(() => {
    prisma.user.count = originalMethods.userCount;
    prisma.fundingRequest.aggregate = originalMethods.fundingAggregate;
    prisma.payoutRequest.aggregate = originalMethods.payoutAggregate;
    prisma.refundRequest.aggregate = originalMethods.refundAggregate;
    prisma.$queryRaw = originalMethods.queryRaw;
  });

  prisma.user.count = async () => 0;
  prisma.fundingRequest.aggregate = async () => ({ _count: { _all: 0 }, _sum: { amount: 0 } });
  prisma.payoutRequest.aggregate = async () => ({ _count: { _all: 0 }, _sum: { amount: 0 } });
  prisma.refundRequest.aggregate = async () => ({ _count: { _all: 0 }, _sum: { amount: 0 } });

  const queries = [];
  prisma.$queryRaw = async (strings, ...values) => {
    const query = Prisma.sql(strings, ...values);
    queries.push(query);
    if (query.sql.includes('AS "unusedCount"')) {
      return [{
        bucket: "All time",
        count: 2,
        amount: 1000,
        unusedCount: 1,
        unusedAmount: 300,
        usedCount: 1,
        usedAmount: 700,
      }];
    }
    return [];
  };

  const analytics = await getAdminAnalytics({ period: "month", scope: "all-time" });

  assert.equal(analytics.filters.scope, "all-time");
  assert.equal(analytics.filters.from, null);
  assert.equal(analytics.filters.to, null);
  assert.equal(analytics.series.length, 1);
  assert.equal(analytics.series[0].bucket, "All time");
  assert.equal(queries.length, 9);
  assert.ok(queries.every((query) => query.sql.includes("'All time'") && query.sql.includes("TRUE")));
  assert.equal(analytics.periodTotals.unusedFundingAmount, 300);
  assert.equal(analytics.periodTotals.usedFundingAmount, 700);
});

test("monthly approved, unused, and used funding totals use the selected approval month", async (t) => {
  const originalMethods = {
    userCount: prisma.user.count,
    fundingAggregate: prisma.fundingRequest.aggregate,
    payoutAggregate: prisma.payoutRequest.aggregate,
    refundAggregate: prisma.refundRequest.aggregate,
    queryRaw: prisma.$queryRaw,
  };
  t.after(() => {
    prisma.user.count = originalMethods.userCount;
    prisma.fundingRequest.aggregate = originalMethods.fundingAggregate;
    prisma.payoutRequest.aggregate = originalMethods.payoutAggregate;
    prisma.refundRequest.aggregate = originalMethods.refundAggregate;
    prisma.$queryRaw = originalMethods.queryRaw;
  });

  prisma.user.count = async () => 0;
  prisma.fundingRequest.aggregate = async () => ({ _count: { _all: 0 }, _sum: { amount: 0 } });
  prisma.payoutRequest.aggregate = async () => ({ _count: { _all: 0 }, _sum: { amount: 0 } });
  prisma.refundRequest.aggregate = async () => ({ _count: { _all: 0 }, _sum: { amount: 0 } });

  let fundingQuery;
  prisma.$queryRaw = async (strings, ...values) => {
    const query = Prisma.sql(strings, ...values);
    if (query.sql.includes('AS "unusedCount"')) {
      fundingQuery = query;
      return [{
        bucket: "2026-10",
        count: 2,
        amount: 1000,
        unusedCount: 1,
        unusedAmount: 300,
        usedCount: 1,
        usedAmount: 700,
      }];
    }
    return [];
  };

  const analytics = await getAdminAnalytics({
    period: "month",
    from: "2026-10-01",
    to: "2026-10-31",
  });

  assert.equal(analytics.periodTotals.fundingTransferredAmount, 1000);
  assert.equal(analytics.periodTotals.unusedFundingAmount, 300);
  assert.equal(analytics.periodTotals.usedFundingAmount, 700);
  const dateValues = fundingQuery.values
    .filter((value) => value instanceof Date)
    .map((value) => value.toISOString());
  assert.ok(dateValues.includes("2026-10-01T00:00:00.000Z"));
  assert.ok(dateValues.includes("2026-11-01T00:00:00.000Z"));
});

test("unused funding drilldown applies the selected approval month", async (t) => {
  const originalMethods = {
    findMany: prisma.fundingRequest.findMany,
    count: prisma.fundingRequest.count,
  };
  t.after(() => {
    prisma.fundingRequest.findMany = originalMethods.findMany;
    prisma.fundingRequest.count = originalMethods.count;
  });

  let capturedWhere;
  prisma.fundingRequest.findMany = async ({ where }) => {
    capturedWhere = where;
    return [];
  };
  prisma.fundingRequest.count = async ({ where }) => {
    capturedWhere = where;
    return 0;
  };

  await listAdminAnalyticsRecords({
    type: "unused-funding",
    from: "2026-10-01",
    to: "2026-10-31",
  });

  assert.deepEqual(capturedWhere.approvedAt, {
    gte: new Date("2026-10-01T00:00:00.000Z"),
    lt: new Date("2026-11-01T00:00:00.000Z"),
  });
  assert.equal(capturedWhere.archivedAt, null);
});

test("funding records can be filtered by their displayed status", async (t) => {
  const originalMethods = {
    findMany: prisma.fundingRequest.findMany,
    count: prisma.fundingRequest.count,
  };
  t.after(() => {
    prisma.fundingRequest.findMany = originalMethods.findMany;
    prisma.fundingRequest.count = originalMethods.count;
  });

  let capturedWhere;
  prisma.fundingRequest.findMany = async ({ where }) => {
    capturedWhere = where;
    return [];
  };
  prisma.fundingRequest.count = async ({ where }) => {
    capturedWhere = where;
    return 0;
  };

  const expectedStatuses = {
    approved: { status: "APPROVED", refunds: { none: {} } },
    pending: { status: "PENDING_FUNDER_APPROVAL", refunds: { none: {} } },
    rejected: { status: "FUNDER_REJECTED", refunds: { none: {} } },
    refund: {
      OR: [
        { refunds: { some: {} } },
        { status: "REFUNDED" },
        { status: "REFUND_PENDING" },
      ],
    },
  };
  for (const [status, expected] of Object.entries(expectedStatuses)) {
    await listAdminAnalyticsRecords({ type: "funding", status });
    assert.deepEqual(capturedWhere, { archivedAt: null, ...expected });
  }

  await assert.rejects(
    listAdminAnalyticsRecords({ type: "funding", status: "unknown" }),
    { statusCode: 400 },
  );
});
