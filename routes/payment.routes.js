import { Router } from "express";
import { getEarnings, listPaymentRequests } from "../services/work.service.js";
import { requireAuthenticatedAccountType } from "../middleware/auth.middleware.js";

export const paymentRouter = Router();
paymentRouter.use(requireAuthenticatedAccountType("EMPLOYEE"));

paymentRouter.get("/", async (request, response, next) => {
  try {
    const payments = await listPaymentRequests(request.authUser.id);
    response.json(payments);
  } catch (error) {
    next(error);
  }
});

paymentRouter.get("/earnings", async (request, response, next) => {
  try {
    const earnings = await getEarnings(request.authUser.id);
    response.json(earnings);
  } catch (error) {
    next(error);
  }
});
