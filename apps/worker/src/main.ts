import { prisma } from "@deepvue/db";
import { errorText, logger } from "@deepvue/platform";
import { healthService } from "./services/health.service";
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
    void workerService
      .shutdown(signal)
      .then(() => healthService.stop())
      .then(disconnect)
      .then(() => process.exit(0));
  });
}

healthService.start();

workerService.run().catch(async (err) => {
  logger.error({ event: "worker.fatal", error: errorText(err) });
  healthService.stop();
  await disconnect();
  process.exit(1);
});
