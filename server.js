import "dotenv/config";
import express from "express";
import { authRouter } from "./routes/auth.routes.js";
import { prisma } from "./lib/prisma.js";
import { paymentRouter } from "./routes/payment.routes.js";
import { supervisorRouter } from "./routes/supervisor.routes.js";
import { workRouter } from "./routes/work.routes.js";
import { fundingRouter } from "./routes/funding.routes.js";
import { funderRouter } from "./routes/funder.routes.js";
import { payoutRouter } from "./routes/payout.routes.js";
import { adminRouter } from "./routes/admin.routes.js";
import { leaderboardRouter } from "./routes/leaderboard.routes.js";

const app = express();
const port = Number(process.env.PORT || 4000);
const clientOrigin = process.env.CLIENT_ORIGIN || "http://localhost:3000";
const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use((request, response, next) => {
  const origin = request.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    response.header("Access-Control-Allow-Origin", origin);
  } else if (allowedOrigins.length > 0) {
    response.header("Access-Control-Allow-Origin", allowedOrigins[0]);
  }
  response.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  if (request.method === "OPTIONS") return response.sendStatus(204);
  next();
});
app.use(express.json());
app.use("/api/auth", authRouter);
app.use("/api/works", workRouter);
app.use("/api/funding-requests", fundingRouter);
app.use("/api/funder", funderRouter);
app.use("/api/payments", paymentRouter);
app.use("/api/payouts", payoutRouter);
app.use("/api/admin", adminRouter);
app.use("/api/leaderboard", leaderboardRouter);
app.use("/api/supervisor", supervisorRouter);

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, service: "ops-hub-server" });
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(error.statusCode || 500).json({
    error: error.statusCode ? error.message : "Internal server error",
  });
});

const server = app.listen(port, () => {
  console.log(`OPS backend listening at http://localhost:${port}`);
});

const shutdown = async () => {
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
