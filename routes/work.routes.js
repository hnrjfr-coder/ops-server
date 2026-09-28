import { Router } from "express";
import { createWorkSubmission, listWorkSubmissions } from "../services/work.service.js";
import { requireAccountType } from "../middleware/auth.middleware.js";

export const workRouter = Router();
workRouter.use(requireAccountType("EMPLOYEE"));

workRouter.get("/", async (request, response, next) => {
  try {
    const works = await listWorkSubmissions(request.authUser?.id || (request.query.employeeId ? String(request.query.employeeId) : undefined));
    response.json(works);
  } catch (error) {
    next(error);
  }
});

workRouter.post("/", async (request, response, next) => {
  try {
    const work = await createWorkSubmission({ ...request.body, employeeId: request.authUser?.id || request.body.employeeId });
    response.status(201).json(work);
  } catch (error) {
    next(error);
  }
});
