import { Router } from "express";
import { completeAccountSetup, getRegistrationOptions, loginUser, registerUser } from "../services/auth.service.js";
import { requireAccountType } from "../middleware/auth.middleware.js";

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

authRouter.put("/account-setup", requireAccountType("EMPLOYEE", "SUPERVISOR", "FUNDER", "ADMIN"), async (request, response, next) => {
  try {
    if (!request.authUser) return response.status(401).json({ error: "Authentication required." });
    const user = await completeAccountSetup(request.authUser.id, request.body);
    response.json({ user });
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

authRouter.get("/me", requireAccountType("EMPLOYEE", "SUPERVISOR", "FUNDER", "ADMIN"), async (request, response, next) => {
  try {
    if (!request.authUser) return response.status(401).json({ error: "Authentication required." });
    const { passwordHash: _passwordHash, ...user } = request.authUser;
    response.json({ user });
  } catch (error) {
    next(error);
  }
});
