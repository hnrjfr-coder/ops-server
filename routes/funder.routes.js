import { Router } from "express";
import { requireAuthenticatedAccountType } from "../middleware/auth.middleware.js";
import { decideFundingRequest, getFunderFundingSummary, listFunderFundingRequests } from "../services/funding.service.js";

export const funderRouter = Router();
funderRouter.use(requireAuthenticatedAccountType("FUNDER"));

funderRouter.get("/summary", async (request, response, next) => {
  try {
    const funderId = request.authUser.id;
    response.json(await getFunderFundingSummary(funderId));
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
    );
    response.json(result);
  } catch (error) {
    next(error);
  }
});