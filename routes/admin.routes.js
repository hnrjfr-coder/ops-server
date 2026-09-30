import { Router } from "express";
import { requireAuthenticatedAccountType } from "../middleware/auth.middleware.js";
import { getAdminOverview, getAdminStaffDetails, listAdminStaff } from "../services/admin.service.js";
import { getAdminAnalytics } from "../services/analytics.service.js";

export const adminRouter = Router();
adminRouter.use(requireAuthenticatedAccountType("ADMIN"));

adminRouter.get("/overview", async (_request, response, next) => {
  try {
    response.json(await getAdminOverview());
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/staff", async (_request, response, next) => {
  try {
    response.json(await listAdminStaff());
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/staff/:staffId", async (request, response, next) => {
  try {
    response.json(await getAdminStaffDetails(request.params.staffId));
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/analytics", async (request, response, next) => {
  try {
    response.json(await getAdminAnalytics(request.query));
  } catch (error) {
    next(error);
  }
});