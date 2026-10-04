import { Router } from "express";
import { requireAuthenticatedAccountType } from "../middleware/auth.middleware.js";
import { approveEmployeeAccount, getAdminOverview, getAdminSignupNotifications, getAdminStaffDetails, listAdminStaff } from "../services/admin.service.js";
import { getAdminAnalytics, listAdminAnalyticsRecords } from "../services/analytics.service.js";

export const adminRouter = Router();
adminRouter.use(requireAuthenticatedAccountType("ADMIN"));

adminRouter.get("/overview", async (_request, response, next) => {
  try {
    response.json(await getAdminOverview());
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/notifications", async (_request, response, next) => {
  try {
    response.json(await getAdminSignupNotifications());
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

adminRouter.get("/analytics/records", async (request, response, next) => {
  try {
    response.json(await listAdminAnalyticsRecords(request.query));
  } catch (error) {
    next(error);
  }
});

adminRouter.patch("/staff/:staffId/approval", async (request, response, next) => {
  try {
    response.json(await approveEmployeeAccount(request.params.staffId, request.authUser.id));
  } catch (error) {
    next(error);
  }
});