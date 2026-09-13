import { prisma } from "@deepvue/db";
import { errorText, logger } from "@deepvue/platform";
import { workerService } from "./services/worker.service";

async function disconnect(): Promise<void> {
  try {
    await prisma.$disconnect();
  } catch (err) {
    logger.error({ event: "worker.disconnect_failed", error: errorText(err) });
  }
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    void workerService.shutdown(signal).then(disconnect).then(() => process.exit(0));
  });
}

workerService.run().catch(async (err) => {
  logger.error({ event: "worker.fatal", error: errorText(err) });
  await disconnect();
  process.exit(1);
});
