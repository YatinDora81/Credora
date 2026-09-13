import { Prisma } from "@prisma/client";
import type { UpstreamState } from "@prisma/client";
import { prisma } from "../client";

export const UPSTREAM_STATE_ID = "upstream";

export interface FailureTransition {
  circuit: string;
  consecutiveFailures: number;
  previousCircuit: string;
}

export class UpstreamStateRepository {
  read = async (): Promise<UpstreamState> =>
    prisma.upstreamState.upsert({
      where: { id: UPSTREAM_STATE_ID },
      update: {},
      create: { id: UPSTREAM_STATE_ID },
    });

  find = async (): Promise<UpstreamState | null> =>
    prisma.upstreamState.findUnique({ where: { id: UPSTREAM_STATE_ID } });

  tryOpenProbe = async (openedAt: Date | null): Promise<boolean> => {
    const won = await prisma.upstreamState.updateMany({
      where: { id: UPSTREAM_STATE_ID, circuit: "OPEN", openedAt },
      data: { circuit: "HALF_OPEN" },
    });
    return won.count === 1;
  };

  reclaimProbe = async (openedAt: Date | null, now: Date): Promise<boolean> => {
    const taken = await prisma.upstreamState.updateMany({
      where: { id: UPSTREAM_STATE_ID, circuit: "HALF_OPEN", openedAt },
      data: { openedAt: now },
    });
    return taken.count === 1;
  };

  recordSuccess = async (now: Date): Promise<UpstreamState> =>
    prisma.upstreamState.update({
      where: { id: UPSTREAM_STATE_ID },
      data: {
        circuit: "CLOSED",
        consecutiveFailures: 0,
        openedAt: null,
        lastSuccessAt: now,
        lastError: null,
      },
    });

  recordFailure = async (
    message: string,
    threshold: number,
    now: Date,
  ): Promise<FailureTransition | null> =>
    prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{ circuit: string; consecutive_failures: number }>
      >(Prisma.sql`
        SELECT circuit, "consecutiveFailures" AS consecutive_failures
        FROM "UpstreamState"
        WHERE id = ${UPSTREAM_STATE_ID}
        FOR UPDATE
      `);
      const prev = locked[0];
      if (!prev) return null;

      const previousCircuit = prev.circuit;
      const next = Number(prev.consecutive_failures) + 1;
      const opening = previousCircuit === "HALF_OPEN" || next >= threshold;
      const circuit = opening ? "OPEN" : previousCircuit;
      const stampOpenedAt =
        previousCircuit === "HALF_OPEN" || (opening && previousCircuit !== "OPEN");

      await tx.$executeRaw(Prisma.sql`
        UPDATE "UpstreamState"
        SET "consecutiveFailures" = ${next},
            "lastFailureAt"       = ${now},
            "lastError"           = ${message},
            "updatedAt"           = ${now},
            circuit               = ${circuit},
            "openedAt"            = ${stampOpenedAt ? Prisma.sql`${now}` : Prisma.sql`"openedAt"`}
        WHERE id = ${UPSTREAM_STATE_ID}
      `);

      return { circuit, consecutiveFailures: next, previousCircuit };
    });

  releaseProbe = async (now: Date): Promise<void> => {
    await prisma.upstreamState.updateMany({
      where: { id: UPSTREAM_STATE_ID, circuit: "HALF_OPEN" },
      data: { circuit: "OPEN", updatedAt: now },
    });
  };

  recordRateLimited = async (message: string, now: Date): Promise<void> => {
    await prisma.upstreamState.update({
      where: { id: UPSTREAM_STATE_ID },
      data: { lastError: message, lastFailureAt: now },
    });
  };
}

export const upstreamStateRepository = new UpstreamStateRepository();
