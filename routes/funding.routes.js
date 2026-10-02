import { Router } from "express";
import { requireAuthenticatedAccountType } from "../middleware/auth.middleware.js";
import { createFundingRequest, getEmployeeFundingSummary, listEmployeeFundingRequests } from "../services/funding.service.js";

export const fundingRouter = Router();
fundingRouter.use(requireAuthenticatedAccountType("EMPLOYEE"));

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