import test from "node:test";
import assert from "node:assert/strict";
import { getCurrentLeaderboardMonth, rankEmployeeLeaderboard } from "./leaderboard.service.js";

test("leaderboard month boundaries use the Nigeria calendar month", () => {
  const result = getCurrentLeaderboardMonth(new Date("2026-10-06T08:00:00.000Z"));

  assert.equal(result.month, "2026-10");
  assert.equal(result.timeZone, "Africa/Lagos");
  assert.equal(result.start.toISOString(), "2026-09-30T23:00:00.000Z");
  assert.equal(result.end.toISOString(), "2026-10-31T23:00:00.000Z");
});

test("leaderboard combines relative earnings and completed-job points equally", () => {
  const result = rankEmployeeLeaderboard([
    { employeeId: "one", name: "Employee One", earnings: 100000, completedJobs: 1 },
    { employeeId: "two", name: "Employee Two", earnings: 50000, completedJobs: 3 },
    { employeeId: "three", name: "Employee Three", earnings: 0, completedJobs: 2 },
  ]);

  assert.deepEqual(
    result.map(({ employeeId, rank, earnings, completedJobs, points }) => ({
      employeeId,
      rank,
      earnings,
      completedJobs,
      points,
    })),
    [
      { employeeId: "two", rank: 1, earnings: 50000, completedJobs: 3, points: 75 },
      { employeeId: "one", rank: 2, earnings: 100000, completedJobs: 1, points: 50 },
      { employeeId: "three", rank: 3, earnings: 0, completedJobs: 2, points: 25 },
    ],
  );
});

test("equal metric values share points and use employee name for exact ties", () => {
  const result = rankEmployeeLeaderboard([
    { employeeId: "b", name: "Bee", earnings: 100, completedJobs: 2 },
    { employeeId: "a", name: "Aye", earnings: 100, completedJobs: 2 },
    { employeeId: "c", name: "Cee", earnings: 10, completedJobs: 1 },
  ]);

  assert.equal(result[0].employeeId, "a");
  assert.equal(result[1].employeeId, "b");
  assert.equal(result[0].points, result[1].points);
  assert.equal(result[2].rank, 3);
});

test("earnings break a tie between equal overall points", () => {
  const result = rankEmployeeLeaderboard([
    { employeeId: "earnings", name: "Zed", earnings: 100, completedJobs: 1 },
    { employeeId: "jobs", name: "Aye", earnings: 10, completedJobs: 3 },
  ]);

  assert.equal(result[0].employeeId, "earnings");
  assert.equal(result[0].points, result[1].points);
});

test("a single employee has 100 points", () => {
  const [result] = rankEmployeeLeaderboard([
    { employeeId: "one", name: "Employee One", earnings: 100, completedJobs: 1 },
  ]);

  assert.equal(result.points, 100);
  assert.deepEqual(Object.keys(result).sort(), ["completedJobs", "earnings", "employeeId", "name", "points", "rank"]);
});

test("leaderboard ranking discards unrequested category breakdowns", () => {
  const [result] = rankEmployeeLeaderboard([
    { employeeId: "one", name: "Employee One", earnings: 100, completedJobs: 1, subscriptions: 1, renewals: 0 },
  ]);

  assert.equal("subscriptions" in result, false);
  assert.equal("renewals" in result, false);
});
