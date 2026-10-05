import { Router } from "express";
import { requireAuthenticatedAccountType } from "../middleware/auth.middleware.js";
import {
  createEmployeePayoutRequest,
  decidePayoutRequest,
  getEmployeePayoutSummary,
  listAdminPayoutRequests,
  listEmployeePayoutRequests,
} from "../services/payout.service.js";

export const payoutRouter = Router();

payoutRouter.get("/summary", requireAuthenticatedAccountType("EMPLOYEE"), async (request, response, next) => {
  try {
    response.json(await getEmployeePayoutSummary(request.authUser.id));
  } catch (error) {
    next(error);
  }
});

payoutRouter.get("/requests", requireAuthenticatedAccountType("EMPLOYEE"), async (request, response, next) => {
  try {
    response.json(await listEmployeePayoutRequests(request.authUser.id, request.query));
  } catch (error) {
    next(error);
  }
});

payoutRouter.post("/requests", requireAuthenticatedAccountType("EMPLOYEE"), async (request, response, next) => {
  try {
    const payoutRequest = await createEmployeePayoutRequest(request.authUser.id);
    response.status(201).json(payoutRequest);
  } catch (error) {
    next(error);
  }
});

payoutRouter.get("/admin/requests", requireAuthenticatedAccountType("ADMIN"), async (request, response, next) => {
  try {
    response.json(await listAdminPayoutRequests(request.query));
  } catch (error) {
    next(error);
  }
});

payoutRouter.patch("/admin/requests/:requestId", requireAuthenticatedAccountType("ADMIN"), async (request, response, next) => {
  try {
    const payoutRequest = await decidePayoutRequest(
      request.params.requestId,
      request.authUser.id,
      String(request.body?.decision || "").toUpperCase(),
      request.body?.adminNote,
    );
    response.json(payoutRequest);
  } catch (error) {
    next(error);
  }
});
