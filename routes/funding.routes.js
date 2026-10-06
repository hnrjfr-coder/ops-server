import { Router } from "express";
import { requireAuthenticatedAccountType } from "../middleware/auth.middleware.js";
import { createFundingRequest, getEmployeeFundingSummary, listEmployeeFundingRequests } from "../services/funding.service.js";
import { createEmployeeRefundRequest, getEmployeeRefundDetails, listEmployeeRefundRequests } from "../services/refund.service.js";
import { createEmployeeFundingReport, getEmployeeFundingReportSummary, listEmployeeFundingReports } from "../services/funding-report.service.js";

export const fundingRouter = Router();
fundingRouter.use(requireAuthenticatedAccountType("EMPLOYEE"));

fundingRouter.get("/reports", async (request, response, next) => {
  try {
    response.json(await listEmployeeFundingReports(request.authUser.id, request.query));
  } catch (error) {
    next(error);
  }
});

fundingRouter.get("/reports/summary", async (request, response, next) => {
  try {
    response.json(await getEmployeeFundingReportSummary(request.authUser.id));
  } catch (error) {
    next(error);
  }
});

fundingRouter.get("/refunds", async (request, response, next) => {
  try {
    response.json(await listEmployeeRefundRequests(request.authUser.id, request.query));
  } catch (error) {
    next(error);
  }
});

fundingRouter.get("/:requestId/refund-details", async (request, response, next) => {
  try {
    response.json(await getEmployeeRefundDetails(request.authUser.id, request.params.requestId));
  } catch (error) {
    next(error);
  }
});

fundingRouter.post("/:requestId/refund", async (request, response, next) => {
  try {
    const refund = await createEmployeeRefundRequest(request.authUser.id, {
      ...request.body,
      fundingRequestId: request.params.requestId,
    });
    response.status(201).json(refund);
  } catch (error) {
    next(error);
  }
});

fundingRouter.get("/summary", async (request, response, next) => {
  try {
    const employeeId = request.authUser.id;
    response.json(await getEmployeeFundingSummary(employeeId, request.query));
  } catch (error) {
    next(error);
  }
});

fundingRouter.get("/", async (request, response, next) => {
  try {
    const result = await listEmployeeFundingRequests(request.authUser.id, request.query);
    response.json(result);
  } catch (error) {
    next(error);
  }
});

fundingRouter.post("/", async (request, response, next) => {
  try {
    const fundingRequest = await createFundingRequest(request.authUser.id, request.body);
    response.status(201).json(fundingRequest);
  } catch (error) {
    next(error);
  }
});

fundingRouter.post("/:requestId/report", async (request, response, next) => {
  try {
    const report = await createEmployeeFundingReport(request.authUser.id, request.params.requestId, request.body);
    response.status(201).json(report);
  } catch (error) {
    next(error);
  }
});