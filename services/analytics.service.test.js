import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { getAdminAnalytics, getUnusedFundingWhere } from "./analytics.service.js";

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
    queries.push(Prisma.sql(strings, ...values));
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
});
