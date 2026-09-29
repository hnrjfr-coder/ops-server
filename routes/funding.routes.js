import { Router } from "express";
import { requireAccountType } from "../middleware/auth.middleware.js";
import { createFundingRequest, getEmployeeFundingSummary, listEmployeeFundingRequests } from "../services/funding.service.js";

export const fundingRouter = Router();
fundingRouter.use(requireAccountType("EMPLOYEE"));

fundingRouter.get("/summary", async (request, response, next) => {
  try {
    const employeeId = request.authUser?.id || String(request.query.employeeId || "");
    response.json(await getEmployeeFundingSummary(employeeId));
  } catch (error) {
    next(error);
  }
});

fundingRouter.get("/", async (request, response, next) => {
  try {
    const result = await listEmployeeFundingRequests(request.authUser?.id || String(request.query.employeeId || ""), request.query);
    response.json(result);
  } catch (error) {
    next(error);
  }
});

fundingRouter.post("/", async (request, response, next) => {
  try {
    const fundingRequest = await createFundingRequest(request.authUser?.id || String(request.body.employeeId || ""), request.body);
    response.status(201).json(fundingRequest);
  } catch (error) {
    next(error);
  }
});