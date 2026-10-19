import "dotenv/config";
import { prisma } from "../lib/prisma.js";

try {
  const result = await prisma.fundingRequest.updateMany({
    where: { status: "REFUNDED", archivedAt: null },
    data: { archivedAt: new Date() },
  });

  console.log(`Archived ${result.count} refunded funding request(s).`);
} catch (error) {
  console.error("Unable to archive refunded funding requests:", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
