import { Router } from "express";
import { requireAuthenticatedAccountType } from "../middleware/auth.middleware.js";
import { decideFundingRequest, getFunderFundingSummary, listActiveFundingSupervisors, listFunderFundingRequests } from "../services/funding.service.js";
import { decideRefundRequest, getFunderRefundAccount, listFunderRefundRequests, updateFunderRefundAccount } from "../services/refund.service.js";
import { decideFundingReport, listFunderFundingReports } from "../services/funding-report.service.js";

export const funderRouter = Router();
funderRouter.use(requireAuthenticatedAccountType("FUNDER"));

funderRouter.get("/supervisors", async (_request, response, next) => {
  try {
    response.json(await listActiveFundingSupervisors());
  } catch (error) {
    next(error);
  }
});

funderRouter.get("/refund-account", async (request, response, next) => {
  try {
    response.json(await getFunderRefundAccount(request.authUser.id));
  } catch (error) {
    next(error);
  }
});

funderRouter.put("/refund-account", async (request, response, next) => {
  try {
    response.json(await updateFunderRefundAccount(request.authUser.id, request.body));
  } catch (error) {
    next(error);
  }
});

funderRouter.get("/refunds", async (request, response, next) => {
  try {
    response.json(await listFunderRefundRequests(request.authUser.id, request.query));
  } catch (error) {
    next(error);
  }
});

funderRouter.patch("/refunds/:refundId", async (request, response, next) => {
  try {
    const result = await decideRefundRequest(
      request.authUser.id,
      request.params.refundId,
      String(request.body?.decision || "").toUpperCase(),
      request.body?.funderNote,
    );
    response.json(result);
  } catch (error) {
    next(error);
  }
});

funderRouter.get("/summary", async (request, response, next) => {
  try {
    const funderId = request.authUser.id;
    response.json(await getFunderFundingSummary(funderId, request.query));
  } catch (error) {
    next(error);
  }
});

funderRouter.get("/requests", async (request, response, next) => {
  try {
    const requests = await listFunderFundingRequests(request.authUser.id, request.query);
    response.json(requests);
  } catch (error) {
    next(error);
  }
});

funderRouter.patch("/requests/:requestId", async (request, response, next) => {
  try {
    const result = await decideFundingRequest(
      request.authUser.id,
      request.params.requestId,
      String(request.body.decision || "").toUpperCase(),
      request.body.transferConfirmed === true,
      String(request.body.supervisorId || ""),
    );
    response.json(result);
  } catch (error) {
    next(error);
  }
});

funderRouter.get("/funding-reports", async (request, response, next) => {
  try {
    response.json(await listFunderFundingReports(request.authUser.id, request.query));
  } catch (error) {
    next(error);
  }
});

funderRouter.patch("/funding-reports/:reportId", async (request, response, next) => {
  try {
    const result = await decideFundingReport(
      request.authUser.id,
      request.params.reportId,
      String(request.body?.decision || "").toUpperCase(),
      request.body?.funderNote,
    );
    response.json(result);
  } catch (error) {
    next(error);
  }
});