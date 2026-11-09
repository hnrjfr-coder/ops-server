import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  getConfirmedFundingWhere,
  getUnusedApprovedFundingWhere,
} from "./funding.service.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const periods = {
  day: { dateFormat: "YYYY-MM-DD", maxBuckets: 366 },
  month: { dateFormat: "YYYY-MM", maxBuckets: 60 },
  year: { dateFormat: "YYYY", maxBuckets: 20 },
};

function invalidInput(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function utcDate(value, fieldName) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) {
    throw invalidInput(`${fieldName} must use YYYY-MM-DD format.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw invalidInput(`${fieldName} must be a valid calendar date.`);
  }
  return date;
}

function getDateRange(period, input) {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let from;
  let to;

  if (input.from || input.to) {
    if (!input.from || !input.to) throw invalidInput("Provide both from and to dates.");
    from = utcDate(String(input.from), "from");
    to = utcDate(String(input.to), "to");
  } else if (period === "day") {
    from = new Date(today.getTime() - 29 * DAY_MS);
    to = today;
  } else if (period === "month") {
    from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1));
    to = today;
  } else {
    from = new Date(Date.UTC(today.getUTCFullYear() - 4, 0, 1));
    to = today;
  }

  if (from > to) throw invalidInput("from must be on or before to.");

  const bucketCount = period === "day"
    ? Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1
    : period === "month"
      ? (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + to.getUTCMonth() - from.getUTCMonth() + 1
      : to.getUTCFullYear() - from.getUTCFullYear() + 1;
  if (bucketCount > periods[period].maxBuckets) {
    throw invalidInput(`The ${period} view supports at most ${periods[period].maxBuckets} buckets.`);
  }

  return { from, to, endExclusive: new Date(to.getTime() + DAY_MS) };
}

function bucketKey(date, period) {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  if (period === "year") return year;
  if (period === "month") return `${year}-${month}`;
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createBuckets(from, to, period) {
  const cursor = new Date(Date.UTC(
    from.getUTCFullYear(),
    period === "year" ? 0 : from.getUTCMonth(),
    period === "day" ? from.getUTCDate() : 1,
  ));
  const finalBucket = bucketKey(to, period);
  const buckets = [];

  while (bucketKey(cursor, period) <= finalBucket) {
    buckets.push(bucketKey(cursor, period));
    if (period === "day") cursor.setUTCDate(cursor.getUTCDate() + 1);
    else if (period === "month") cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    else cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);
  }
  return buckets;
}

function toNumber(value) {
  return Number(value || 0);
}

function indexRows(rows) {
  return new Map(rows.map((row) => [row.bucket, row]));
}

export function getUnusedFundingWhere() {
  return getUnusedApprovedFundingWhere();
}

async function getCurrentSnapshot() {
  const [employeeCount, activeEmployeeCount, pendingFunding, pendingPayouts, pendingRefunds, confirmedFunding, unusedFunding, usedFunding] = await Promise.all([
    prisma.user.count({ where: { accountType: "EMPLOYEE" } }),
    prisma.user.count({ where: { accountType: "EMPLOYEE", status: "ACTIVE" } }),
    prisma.fundingRequest.aggregate({
      where: { status: "PENDING_FUNDER_APPROVAL", archivedAt: null },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.payoutRequest.aggregate({
      where: { status: "PENDING" },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.refundRequest.aggregate({
      where: { status: "PENDING_FUNDER_APPROVAL" },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.fundingRequest.aggregate({
      where: { ...getConfirmedFundingWhere(), archivedAt: null },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.fundingRequest.aggregate({
      where: getUnusedFundingWhere(),
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.fundingRequest.aggregate({
      where: { approvedAt: { not: null }, work: { isNot: null }, archivedAt: null },
      _count: { _all: true },
      _sum: { amount: true },
    }),
  ]);

  return {
    employees: { total: employeeCount, active: activeEmployeeCount },
    funding: {
      pendingCount: pendingFunding._count._all,
      pendingAmount: pendingFunding._sum.amount || 0,
      approvedCount: confirmedFunding._count._all,
      approvedAmount: confirmedFunding._sum.amount || 0,
      unusedCount: unusedFunding._count._all,
      unusedAmount: unusedFunding._sum.amount || 0,
      usedCount: usedFunding._count._all,
      usedAmount: usedFunding._sum.amount || 0,
    },
    payouts: {
      pendingCount: pendingPayouts._count._all,
      pendingAmount: pendingPayouts._sum.amount || 0,
    },
    refunds: {
      pendingCount: pendingRefunds._count._all,
      pendingAmount: pendingRefunds._sum.amount || 0,
    },
  };
}

export async function getAdminAnalytics(input = {}) {
  const period = String(input.period || "day").toLowerCase();
  if (!Object.hasOwn(periods, period)) throw invalidInput("period must be day, month, or year.");
  const scope = String(input.scope || "").toLowerCase();
  if (scope && scope !== "all-time") throw invalidInput("scope must be all-time when provided.");
  const allTime = scope === "all-time";

  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const { from, to, endExclusive } = allTime
    ? { from: today, to: today, endExclusive: new Date(today.getTime() + DAY_MS) }
    : getDateRange(period, input);
  const dateFormat = periods[period].dateFormat;
  const bucketFor = (column) =>
    allTime
      ? Prisma.sql`'All time'`
      : Prisma.sql`to_char(date_trunc(${period}, ${Prisma.raw(`"${column}"`)} AT TIME ZONE 'UTC'), ${dateFormat})`;
  const dateRangeFor = (column) =>
    allTime
      ? Prisma.sql`TRUE`
      : Prisma.sql`${Prisma.raw(`"${column}"`)} >= ${from} AND ${Prisma.raw(`"${column}"`)} < ${endExclusive}`;
  const fundingBucket = bucketFor("approvedAt");
  const fundingPendingBucket = bucketFor("requestedAt");
  const fundingRejectedBucket = bucketFor("lastStatusChangedAt");
  const payoutRequestBucket = bucketFor("requestedAt");
  const payoutDecisionBucket = bucketFor("processedAt");
  const refundRequestBucket = bucketFor("requestedAt");
  const refundDecisionBucket = bucketFor("processedAt");
  const workBucket = bucketFor("approvedAt");
  const employeeBucket = bucketFor("createdAt");

  const [current, fundingRows, fundingRequestRows, fundingRejectedRows, payoutRequestRows, payoutDecisionRows, refundRequestRows, refundDecisionRows, workRows, employeeRows] = await Promise.all([
    getCurrentSnapshot(),
    prisma.$queryRaw`
      SELECT ${fundingBucket} AS bucket,
        COUNT(*)::int AS count,
        COALESCE(SUM("amount"), 0)::float8 AS amount,
        COUNT(*) FILTER (
          WHERE "status" = 'APPROVED'
            AND NOT EXISTS (
              SELECT 1 FROM "ops"."RefundRequest" r
              WHERE r."fundingRequestId" = "ops"."FundingRequest"."id"
            )
            AND NOT EXISTS (
              SELECT 1 FROM "ops"."WorkSubmission" w
              WHERE w."fundingRequestId" = "ops"."FundingRequest"."id"
            )
        )::int AS "unusedCount",
        COALESCE(SUM("amount") FILTER (
          WHERE "status" = 'APPROVED'
            AND NOT EXISTS (
              SELECT 1 FROM "ops"."RefundRequest" r
              WHERE r."fundingRequestId" = "ops"."FundingRequest"."id"
            )
            AND NOT EXISTS (
              SELECT 1 FROM "ops"."WorkSubmission" w
              WHERE w."fundingRequestId" = "ops"."FundingRequest"."id"
            )
        ), 0)::float8 AS "unusedAmount",
        COUNT(*) FILTER (
          WHERE EXISTS (
            SELECT 1 FROM "ops"."WorkSubmission" w
            WHERE w."fundingRequestId" = "ops"."FundingRequest"."id"
          )
        )::int AS "usedCount",
        COALESCE(SUM("amount") FILTER (
          WHERE EXISTS (
            SELECT 1 FROM "ops"."WorkSubmission" w
            WHERE w."fundingRequestId" = "ops"."FundingRequest"."id"
          )
        ), 0)::float8 AS "usedAmount"
      FROM "ops"."FundingRequest"
      WHERE "archivedAt" IS NULL
        AND ${dateRangeFor("approvedAt")}
      GROUP BY 1 ORDER BY 1
    `,
    prisma.$queryRaw`
      SELECT ${fundingPendingBucket} AS bucket,
        COUNT(*)::int AS "requestedCount",
        COALESCE(SUM("amount"), 0)::float8 AS "requestedAmount",
        COUNT(*) FILTER (WHERE "status" = 'PENDING_FUNDER_APPROVAL')::int AS "pendingCount",
        COALESCE(SUM("amount") FILTER (WHERE "status" = 'PENDING_FUNDER_APPROVAL'), 0)::float8 AS "pendingAmount"
      FROM "ops"."FundingRequest"
      WHERE "archivedAt" IS NULL
        AND ${dateRangeFor("requestedAt")}
      GROUP BY 1 ORDER BY 1
    `,
    prisma.$queryRaw`
      SELECT ${fundingRejectedBucket} AS bucket,
        COUNT(*)::int AS "rejectedCount",
        COALESCE(SUM("amount"), 0)::float8 AS "rejectedAmount"
      FROM "ops"."FundingRequest"
      WHERE "archivedAt" IS NULL
        AND "status" = 'FUNDER_REJECTED'
        AND ${dateRangeFor("lastStatusChangedAt")}
      GROUP BY 1 ORDER BY 1
    `,
    prisma.$queryRaw`
      SELECT ${payoutRequestBucket} AS bucket,
        COUNT(*)::int AS count,
        COALESCE(SUM("amount"), 0)::float8 AS amount
      FROM "ops"."PayoutRequest"
        WHERE ${dateRangeFor("requestedAt")}
      GROUP BY 1 ORDER BY 1
    `,
    prisma.$queryRaw`
      SELECT ${payoutDecisionBucket} AS bucket,
        COUNT(*) FILTER (WHERE "status" IN ('PAID', 'APPROVED'))::int AS "paidCount",
        COALESCE(SUM("amount") FILTER (WHERE "status" IN ('PAID', 'APPROVED')), 0)::float8 AS "paidAmount",
        COUNT(*) FILTER (WHERE "status" = 'REJECTED')::int AS "rejectedCount"
      FROM "ops"."PayoutRequest"
        WHERE ${dateRangeFor("processedAt")}
      GROUP BY 1 ORDER BY 1
    `,
    prisma.$queryRaw`
      SELECT ${refundRequestBucket} AS bucket,
        COUNT(*)::int AS "requestedCount",
        COALESCE(SUM("amount"), 0)::float8 AS "requestedAmount",
        COUNT(*) FILTER (WHERE "status" = 'PENDING_FUNDER_APPROVAL')::int AS "pendingCount",
        COALESCE(SUM("amount") FILTER (WHERE "status" = 'PENDING_FUNDER_APPROVAL'), 0)::float8 AS "pendingAmount"
      FROM "ops"."RefundRequest"
      WHERE ${dateRangeFor("requestedAt")}
      GROUP BY 1 ORDER BY 1
    `,
    prisma.$queryRaw`
      SELECT ${refundDecisionBucket} AS bucket,
        COUNT(*) FILTER (WHERE "status" = 'APPROVED')::int AS "approvedCount",
        COALESCE(SUM("amount") FILTER (WHERE "status" = 'APPROVED'), 0)::float8 AS "approvedAmount",
        COUNT(*) FILTER (WHERE "status" = 'REJECTED')::int AS "rejectedCount"
      FROM "ops"."RefundRequest"
      WHERE ${dateRangeFor("processedAt")}
      GROUP BY 1 ORDER BY 1
    `,
    prisma.$queryRaw`
      SELECT ${workBucket} AS bucket, COUNT(*)::int AS count
      FROM "ops"."WorkSubmission"
      WHERE "status" = 'COMPLETED'
        AND ${dateRangeFor("approvedAt")}
      GROUP BY 1 ORDER BY 1
    `,
    prisma.$queryRaw`
      SELECT ${employeeBucket} AS bucket, COUNT(*)::int AS count
      FROM "ops"."User"
      WHERE "accountType" = 'EMPLOYEE'
        AND ${dateRangeFor("createdAt")}
      GROUP BY 1 ORDER BY 1
    `,
  ]);

  const fundingByBucket = indexRows(fundingRows);
  const fundingRequestsByBucket = indexRows(fundingRequestRows);
  const fundingRejectedByBucket = indexRows(fundingRejectedRows);
  const payoutRequestsByBucket = indexRows(payoutRequestRows);
  const payoutDecisionsByBucket = indexRows(payoutDecisionRows);
  const refundRequestsByBucket = indexRows(refundRequestRows);
  const refundDecisionsByBucket = indexRows(refundDecisionRows);
  const worksByBucket = indexRows(workRows);
  const employeesByBucket = indexRows(employeeRows);
  const series = (allTime ? ["All time"] : createBuckets(from, to, period)).map((bucket) => {
    const funding = fundingByBucket.get(bucket);
    const fundingRequests = fundingRequestsByBucket.get(bucket);
    const fundingRejected = fundingRejectedByBucket.get(bucket);
    const payoutRequests = payoutRequestsByBucket.get(bucket);
    const payoutDecisions = payoutDecisionsByBucket.get(bucket);
    const refundRequests = refundRequestsByBucket.get(bucket);
    const refundDecisions = refundDecisionsByBucket.get(bucket);
    const works = worksByBucket.get(bucket);
    const employees = employeesByBucket.get(bucket);
    return {
      bucket,
      funding: {
        transferredCount: funding?.count || 0,
        transferredAmount: toNumber(funding?.amount),
        unusedCount: funding?.unusedCount || 0,
        unusedAmount: toNumber(funding?.unusedAmount),
        usedCount: funding?.usedCount || 0,
        usedAmount: toNumber(funding?.usedAmount),
        requestedCount: fundingRequests?.requestedCount || 0,
        requestedAmount: toNumber(fundingRequests?.requestedAmount),
        pendingCount: fundingRequests?.pendingCount || 0,
        pendingAmount: toNumber(fundingRequests?.pendingAmount),
        rejectedCount: fundingRejected?.rejectedCount || 0,
        rejectedAmount: toNumber(fundingRejected?.rejectedAmount),
      },
      refunds: {
        requestedCount: refundRequests?.requestedCount || 0,
        requestedAmount: toNumber(refundRequests?.requestedAmount),
        pendingCount: refundRequests?.pendingCount || 0,
        pendingAmount: toNumber(refundRequests?.pendingAmount),
        approvedCount: refundDecisions?.approvedCount || 0,
        approvedAmount: toNumber(refundDecisions?.approvedAmount),
        rejectedCount: refundDecisions?.rejectedCount || 0,
      },
      payouts: {
        requestCount: payoutRequests?.count || 0,
        requestedAmount: toNumber(payoutRequests?.amount),
        paidCount: payoutDecisions?.paidCount || 0,
        paidAmount: toNumber(payoutDecisions?.paidAmount),
        rejectedCount: payoutDecisions?.rejectedCount || 0,
      },
      work: { confirmedCount: works?.count || 0 },
      employees: { newCount: employees?.count || 0 },
    };
  });

  const periodTotals = series.reduce((totals, bucket) => {
    totals.fundingTransferredCount += bucket.funding.transferredCount;
    totals.fundingTransferredAmount += bucket.funding.transferredAmount;
    totals.unusedFundingCount += bucket.funding.unusedCount;
    totals.unusedFundingAmount += bucket.funding.unusedAmount;
    totals.usedFundingCount += bucket.funding.usedCount;
    totals.usedFundingAmount += bucket.funding.usedAmount;
    totals.fundingRequestedCount += bucket.funding.requestedCount;
    totals.fundingRequestedAmount += bucket.funding.requestedAmount;
    totals.fundingPendingCount += bucket.funding.pendingCount;
    totals.fundingPendingAmount += bucket.funding.pendingAmount;
    totals.fundingRejectedCount += bucket.funding.rejectedCount;
    totals.fundingRejectedAmount += bucket.funding.rejectedAmount;
    totals.refundRequestedCount += bucket.refunds.requestedCount;
    totals.refundRequestedAmount += bucket.refunds.requestedAmount;
    totals.refundPendingCount += bucket.refunds.pendingCount;
    totals.refundPendingAmount += bucket.refunds.pendingAmount;
    totals.refundApprovedCount += bucket.refunds.approvedCount;
    totals.refundApprovedAmount += bucket.refunds.approvedAmount;
    totals.refundRejectedCount += bucket.refunds.rejectedCount;
    totals.payoutRequestCount += bucket.payouts.requestCount;
    totals.payoutRequestedAmount += bucket.payouts.requestedAmount;
    totals.payoutPaidCount += bucket.payouts.paidCount;
    totals.payoutPaidAmount += bucket.payouts.paidAmount;
    totals.payoutRejectedCount += bucket.payouts.rejectedCount;
    totals.confirmedWorkCount += bucket.work.confirmedCount;
    totals.newEmployeeCount += bucket.employees.newCount;
    return totals;
  }, {
    fundingTransferredCount: 0,
    fundingTransferredAmount: 0,
    unusedFundingCount: 0,
    unusedFundingAmount: 0,
    usedFundingCount: 0,
    usedFundingAmount: 0,
    fundingRequestedCount: 0,
    fundingRequestedAmount: 0,
    fundingPendingCount: 0,
    fundingPendingAmount: 0,
    fundingRejectedCount: 0,
    fundingRejectedAmount: 0,
    refundRequestedCount: 0,
    refundRequestedAmount: 0,
    refundPendingCount: 0,
    refundPendingAmount: 0,
    refundApprovedCount: 0,
    refundApprovedAmount: 0,
    refundRejectedCount: 0,
    payoutRequestCount: 0,
    payoutRequestedAmount: 0,
    payoutPaidCount: 0,
    payoutPaidAmount: 0,
    payoutRejectedCount: 0,
    confirmedWorkCount: 0,
    newEmployeeCount: 0,
  });

  return {
    filters: {
      period,
      scope: allTime ? "all-time" : "period",
      from: allTime ? null : from.toISOString().slice(0, 10),
      to: allTime ? null : to.toISOString().slice(0, 10),
      timezone: "UTC",
    },
    current,
    periodTotals,
    series,
    notes: {
      fundingTransferred: "Funding is counted when a funder confirms the transfer.",
      refundApproved: "A refund is counted when a funder approves the refund request.",
      payoutPaid: "Admin approval marks a payout as transferred.",
    },
  };
}

export async function listAdminAnalyticsRecords(input = {}) {
  const type = String(input.type || "").toLowerCase();
  if (!["funding", "work", "unused-funding", "rejected-funding"].includes(type)) {
    throw invalidInput("type must be funding, work, unused-funding, or rejected-funding.");
  }
  const page = Math.max(1, Number.parseInt(input.page, 10) || 1);
  const pageSize = Math.min(30, Math.max(1, Number.parseInt(input.pageSize, 10) || 30));
  const skip = (page - 1) * pageSize;

  if (type === "rejected-funding") {
    if (!input.from || !input.to) throw invalidInput("Provide both from and to dates for rejected funding records.");
    const from = utcDate(String(input.from), "from");
    const to = utcDate(String(input.to), "to");
    if (from > to) throw invalidInput("from must be on or before to.");
    const endExclusive = new Date(to.getTime() + DAY_MS);
    const where = {
      status: "FUNDER_REJECTED",
      archivedAt: null,
      lastStatusChangedAt: { gte: from, lt: endExclusive },
    };
    const [items, total] = await Promise.all([
      prisma.fundingRequest.findMany({
        where,
        orderBy: [{ lastStatusChangedAt: "desc" }, { id: "desc" }],
        skip,
        take: pageSize,
        select: {
          id: true,
          accountName: true,
          accountCategory: true,
          amount: true,
          status: true,
          requestedAt: true,
          lastStatusChangedAt: true,
          employee: { select: { id: true, name: true, phone: true } },
          funder: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.fundingRequest.count({ where }),
    ]);
    return { type, items, pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) } };
  }

  if (type === "unused-funding") {
    const where = { ...getUnusedFundingWhere(), archivedAt: null };
    if (input.from || input.to) {
      if (!input.from || !input.to) {
        throw invalidInput("Provide both from and to dates for unused funding records.");
      }
      const from = utcDate(String(input.from), "from");
      const to = utcDate(String(input.to), "to");
      if (from > to) throw invalidInput("from must be on or before to.");
      where.approvedAt = { gte: from, lt: new Date(to.getTime() + DAY_MS) };
    }
    const [items, total] = await Promise.all([
      prisma.fundingRequest.findMany({
        where,
        orderBy: [{ approvedAt: "desc" }, { requestedAt: "desc" }],
        skip,
        take: pageSize,
        select: {
          id: true,
          employee: { select: { id: true, name: true, phone: true } },
          funder: { select: { id: true, name: true } },
          supervisor: { select: { id: true, name: true } },
          accountName: true,
          accountCategory: true,
          amount: true,
          approvedAt: true,
          requestedAt: true,
        },
      }),
      prisma.fundingRequest.count({ where }),
    ]);
    return { type, items, pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) } };
  }

  if (type === "funding") {
    const where = { archivedAt: null };
    const [items, total] = await Promise.all([
      prisma.fundingRequest.findMany({
        where,
        orderBy: { requestedAt: "desc" },
        skip,
        take: pageSize,
        select: {
          id: true,
          employee: { select: { id: true, name: true, phone: true } },
          funder: { select: { id: true, name: true } },
          accountName: true,
          accountCategory: true,
          amount: true,
          status: true,
          requestedAt: true,
          approvedAt: true,
          lastStatusChangedAt: true,
          work: { select: { id: true } },
          refunds: {
            orderBy: { requestedAt: "desc" },
            take: 1,
            select: {
              id: true,
              status: true,
              requestedAt: true,
              processedAt: true,
              funder: { select: { id: true, name: true } },
            },
          },
        },
      }),
      prisma.fundingRequest.count({ where }),
    ]);
    return { type, items, pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) } };
  }

  const where = {};
  const [items, total] = await Promise.all([
    prisma.workSubmission.findMany({
      where,
      orderBy: { submittedAt: "desc" },
      skip,
      take: pageSize,
      select: {
        id: true,
        employee: { select: { id: true, name: true, phone: true } },
        accountName: true,
        accountCategory: true,
        status: true,
        submittedAt: true,
        completedAt: true,
        approvedAt: true,
        fundingRequest: { select: { id: true, status: true, amount: true } },
      },
    }),
    prisma.workSubmission.count({ where }),
  ]);
  return { type, items, pagination: { page, pageSize, total, pageCount: Math.ceil(total / pageSize) } };
}