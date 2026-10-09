import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { PAYOUT_PER_WORK } from "./payout.service.js";

const TIME_ZONE = "Africa/Lagos";
const APPROVED_STATUSES = ["APPROVED", "COMPLETED", "PAID"];

export function getCurrentLeaderboardMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const offsetMs = 60 * 60 * 1000;
  const start = new Date(Date.UTC(year, month - 1, 1) - offsetMs);
  const end = new Date(Date.UTC(year, month, 1) - offsetMs);

  return {
    month: `${year}-${String(month).padStart(2, "0")}`,
    timeZone: TIME_ZONE,
    start,
    end,
  };
}

function assignRelativePoints(rows, metric) {
  const ordered = [...rows].sort((left, right) => right[metric] - left[metric]);
  const points = new Map();
  let index = 0;

  while (index < ordered.length) {
    let end = index + 1;
    while (end < ordered.length && ordered[end][metric] === ordered[index][metric]) end += 1;

    const averageRank = (index + 1 + end) / 2;
    const score = ordered.length <= 1
      ? 100
      : ((ordered.length - averageRank) / (ordered.length - 1)) * 100;
    for (let tiedIndex = index; tiedIndex < end; tiedIndex += 1) {
      points.set(ordered[tiedIndex].employeeId, score);
    }
    index = end;
  }

  return points;
}

export function rankEmployeeLeaderboard(rows) {
  const normalized = rows.map((row) => ({
    employeeId: row.employeeId,
    name: row.name,
    earnings: Number(row.earnings) || 0,
    completedJobs: Number(row.completedJobs) || 0,
  }));
  const earningsPoints = assignRelativePoints(normalized, "earnings");
  const jobsPoints = assignRelativePoints(normalized, "completedJobs");

  return normalized
    .map((row) => {
      const earningsScore = earningsPoints.get(row.employeeId) || 0;
      const jobsScore = jobsPoints.get(row.employeeId) || 0;
      const totalScore = (earningsScore + jobsScore) / 2;
      return {
        employeeId: row.employeeId,
        name: row.name,
        earnings: row.earnings,
        completedJobs: row.completedJobs,
        points: Math.round(totalScore * 10) / 10,
      };
    })
    .sort((left, right) =>
      right.points - left.points ||
      right.earnings - left.earnings ||
      right.completedJobs - left.completedJobs ||
      left.name.localeCompare(right.name),
    )
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function calculateLeaderboardEarnings(completedJobs) {
  return (Number(completedJobs) || 0) * PAYOUT_PER_WORK;
}

export async function getEmployeeLeaderboard() {
  const { month, start, end } = getCurrentLeaderboardMonth();
  const rows = await prisma.$queryRaw`
    SELECT
      employee."id" AS "employeeId",
      employee."name" AS "name",
      COALESCE(work."completedJobs", 0)::int AS "completedJobs"
    FROM "ops"."User" AS employee
    LEFT JOIN (
      SELECT
        "employeeId",
        COUNT(*) AS "completedJobs"
      FROM "ops"."WorkSubmission"
      WHERE "status" IN (${Prisma.join(APPROVED_STATUSES)})
        AND "submittedAt" >= ${start}
        AND "submittedAt" < ${end}
      GROUP BY "employeeId"
    ) AS work ON work."employeeId" = employee."id"
    WHERE employee."accountType" = 'EMPLOYEE'
      AND employee."status" = 'ACTIVE'
      AND work."employeeId" IS NOT NULL
    ORDER BY employee."name" ASC, employee."id" ASC
  `;

  return {
    month,
    employees: rankEmployeeLeaderboard(rows.map((row) => ({
      ...row,
      earnings: calculateLeaderboardEarnings(row.completedJobs),
    }))).map(({ employeeId, name, earnings, completedJobs, points, rank }) => ({
      employeeId,
      name,
      earnings,
      completedJobs,
      points,
      rank,
    })),
  };
}
