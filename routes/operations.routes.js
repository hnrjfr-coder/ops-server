import { Router } from "express";
import { requireAuthenticatedAccountType } from "../middleware/auth.middleware.js";
import { getEmployeeRequestSettings } from "../services/employee-request-settings.service.js";

export const operationsRouter = Router();

operationsRouter.get(
  "/employee-requests",
  requireAuthenticatedAccountType("EMPLOYEE"),
  async (_request, response, next) => {
    try {
      response.json(await getEmployeeRequestSettings());
    } catch (error) {
      next(error);
    }
  },
);
