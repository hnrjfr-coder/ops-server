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
import { createCorsMiddleware, getAllowedOrigins } from "./lib/cors.js";

const app = express();
const port = Number(process.env.PORT || 4000);
const allowedOrigins = getAllowedOrigins(process.env.CLIENT_ORIGIN ?? "http://localhost:3000");

app.use(createCorsMiddleware(allowedOrigins));
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

app.get("/api/health", async (_request, response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    response.json({ ok: true, service: "ops-hub-server", database: "ok" });
  } catch {
    response.status(503).json({ ok: false, service: "ops-hub-server", database: "unavailable" });
  }
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
