import { Router } from "express";
import { createWorkSubmission, getEmployeeWorkSubmission, listWorkSubmissions } from "../services/work.service.js";
import { requireAuthenticatedAccountType } from "../middleware/auth.middleware.js";

export const workRouter = Router();
workRouter.use(requireAuthenticatedAccountType("EMPLOYEE"));

workRouter.get("/", async (request, response, next) => {
  try {
    const works = await listWorkSubmissions(request.authUser.id, request.query);
    response.json(works);
  } catch (error) {
    next(error);
  }
});

workRouter.get("/:workId", async (request, response, next) => {
  try {
    const work = await getEmployeeWorkSubmission(request.authUser.id, request.params.workId);
    if (!work) return response.status(404).json({ error: "Work submission was not found." });
    response.json(work);
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
