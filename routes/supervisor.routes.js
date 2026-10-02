import { Router } from "express";
import { getSupervisorFundingSummary, listSupervisorFundingRequests } from "../services/funding.service.js";
import { getSupervisorEmployees, getSupervisorWorks, updateSupervisedWorkStatus } from "../services/work.service.js";
import { requireAuthenticatedAccountType } from "../middleware/auth.middleware.js";

export const supervisorRouter = Router();
supervisorRouter.use(requireAuthenticatedAccountType("SUPERVISOR"));

supervisorRouter.get("/funding-summary", async (request, response, next) => {
  try {
    const supervisorId = request.authUser.id;
    response.json(await getSupervisorFundingSummary(supervisorId, request.query));
  } catch (error) {
    next(error);
  }
});

supervisorRouter.get("/funding-requests", async (request, response, next) => {
  try {
    const supervisorId = request.authUser.id;
    response.json(await listSupervisorFundingRequests(supervisorId, request.query));
  } catch (error) {
    next(error);
  }
});

supervisorRouter.get("/employees", async (request, response, next) => {
  try {
    const supervisorId = request.authUser.id;
    response.json(await getSupervisorEmployees(supervisorId));
  } catch (error) {
    next(error);
  }
});

supervisorRouter.get("/works", async (request, response, next) => {
  try {
    const supervisorId = request.authUser.id;
    response.json(await getSupervisorWorks(supervisorId, request.query));
  } catch (error) {
    next(error);
  }
});

supervisorRouter.patch("/works/:workId/status", async (request, response, next) => {
  try {
    const supervisorId = request.authUser.id;
    const work = await updateSupervisedWorkStatus(supervisorId, request.params.workId, String(request.body.status || ""));
    response.json(work);
  } catch (error) {
    next(error);
  }
});
