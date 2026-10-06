import { Router } from "express";
import { requireAuthenticatedAccountType } from "../middleware/auth.middleware.js";
import { getEmployeeLeaderboard } from "../services/leaderboard.service.js";

export const leaderboardRouter = Router();
leaderboardRouter.use(requireAuthenticatedAccountType("EMPLOYEE", "ADMIN"));

leaderboardRouter.get("/", async (request, response, next) => {
  try {
    response.json(await getEmployeeLeaderboard(
      request.authUser.accountType === "EMPLOYEE" ? request.authUser.id : null,
    ));
  } catch (error) {
    next(error);
  }
});
