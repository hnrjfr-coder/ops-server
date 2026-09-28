import { Router } from "express";
import { getRegistrationOptions, loginUser, registerUser } from "../services/auth.service.js";

export const authRouter = Router();

authRouter.get("/options", async (_request, response, next) => {
  try {
    response.json(await getRegistrationOptions());
  } catch (error) {
    next(error);
  }
});

authRouter.post("/register", async (request, response, next) => {
  try {
    const user = await registerUser(request.body);
    response.status(201).json({ user });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/login", async (request, response, next) => {
  try {
    const result = await loginUser(request.body);
    response.json(result);
  } catch (error) {
    next(error);
  }
});
