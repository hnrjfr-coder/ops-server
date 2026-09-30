import { Router } from "express";
import { createWorkSubmission, listWorkSubmissions } from "../services/work.service.js";
import { requireAuthenticatedAccountType } from "../middleware/auth.middleware.js";

export const workRouter = Router();
workRouter.use(requireAuthenticatedAccountType("EMPLOYEE"));

workRouter.get("/", async (request, response, next) => {
  try {
    const works = await listWorkSubmissions(request.authUser.id);
    response.json(works);
  } catch (error) {
    next(error);
  }
});

workRouter.post("/", async (request, response, next) => {
  try {
    const work = await createWorkSubmission({ ...request.body, employeeId: request.authUser.id });
    response.status(201).json(work);
  } catch (error) {
    next(error);
  }
});
