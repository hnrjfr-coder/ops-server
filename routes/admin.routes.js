import { Router } from "express";
import { requireAuthenticatedAccountType } from "../middleware/auth.middleware.js";
import { approveEmployeeAccount, deleteAdminFundingRecord, getAdminOverview, getAdminSignupNotifications, getAdminStaffDetails, listAdminStaff } from "../services/admin.service.js";
import { getAdminAnalytics, listAdminAnalyticsRecords } from "../services/analytics.service.js";
import { getAdminEarnings, listAdminPendingSubscriptions } from "../services/admin-earnings.service.js";
import { decideFunderFundingRequest, deleteRejectedFunderFundingRequest, listAdminFunderFundingRequests } from "../services/funder-funding-request.service.js";

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

adminRouter.get("/staff", async (request, response, next) => {
  try {
    response.json(await listAdminStaff(request.query));
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

adminRouter.get("/earnings", async (request, response, next) => {
  try {
    response.json(await getAdminEarnings(request.query));
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/earnings/pending-subscriptions", async (request, response, next) => {
  try {
    response.json(await listAdminPendingSubscriptions(request.query));
  } catch (error) {
    next(error);
  }
});

adminRouter.get("/funder-funding-requests", async (request, response, next) => {
  try {
    response.json(await listAdminFunderFundingRequests(request.query));
  } catch (error) {
    next(error);
  }
});

adminRouter.patch("/funder-funding-requests/:requestId", async (request, response, next) => {
  try {
    response.json(await decideFunderFundingRequest(
      request.params.requestId,
      request.authUser.id,
      String(request.body?.decision || "").toUpperCase(),
      request.body?.adminNote,
    ));
  } catch (error) {
    next(error);
  }
});

adminRouter.delete("/funder-funding-requests/:requestId", async (request, response, next) => {
  try {
    response.json(await deleteRejectedFunderFundingRequest(request.params.requestId));
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

adminRouter.delete("/analytics/funding/:fundingRequestId", async (request, response, next) => {
  try {
    response.json(await deleteAdminFundingRecord(request.params.fundingRequestId));
  } catch (error) {
    next(error);
  }
});