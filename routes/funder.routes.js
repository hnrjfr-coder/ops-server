import { Router } from "express";
import { requireAccountType } from "../middleware/auth.middleware.js";
import { decideFundingRequest, getFunderFundingSummary, listFunderFundingRequests } from "../services/funding.service.js";

export const funderRouter = Router();
funderRouter.use(requireAccountType("FUNDER"));

funderRouter.get("/summary", async (request, response, next) => {
  try {
    const funderId = request.authUser?.id || String(request.query.funderId || "");
    response.json(await getFunderFundingSummary(funderId));
  } catch (error) {
    next(error);
  }
});

funderRouter.get("/requests", async (request, response, next) => {
  try {
    const requests = await listFunderFundingRequests(request.authUser?.id || String(request.query.funderId || ""), request.query);
    response.json(requests);
  } catch (error) {
    next(error);
  }
});

funderRouter.patch("/requests/:requestId", async (request, response, next) => {
  try {
    const result = await decideFundingRequest(
      request.authUser?.id || String(request.body.funderId || ""),
      request.params.requestId,
      String(request.body.decision || "").toUpperCase(),
      request.body.transferConfirmed === true,
    );
    response.json(result);
  } catch (error) {
    next(error);
  }
});