import { Prisma } from "@prisma/client";
import type { Application, ApplicationStatus, UpstreamCall } from "@prisma/client";
import { prisma } from "../client";

export interface NewApplication {
  customerId: string;
  externalId: string | null;
  appliedOn: Date;
  payload: Prisma.InputJsonValue;
  policyCustomerKey: string;
  policyVersion: string;
  deadlineAt: Date;
}

export interface IdempotencyStamp {
  key: string;
  requestHash: string;
}

export interface ListPage {
  customerId: string;
  limit: number;
  cursor: { createdAt: Date; id: string | null } | null;
}

export type ApplicationWithCalls = Application & { upstreamCalls: UpstreamCall[] };

export interface DecisionUpdate {
  status: ApplicationStatus;
  evidence: Prisma.InputJsonValue;
  extraction: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  decision: Prisma.InputJsonValue;
  degraded: boolean;
}

export class ApplicationRepository {
  create = async (data: NewApplication, stamp: IdempotencyStamp | null): Promise<Application> =>
    prisma.$transaction(async (tx) => {
      const application = await tx.application.create({
        data: { ...data, status: "PENDING" },
      });
      if (stamp) {
        await tx.idempotencyRecord.create({
          data: {
            customerId: data.customerId,
            key: stamp.key,
            requestHash: stamp.requestHash,
            applicationId: application.id,
          },
        });
      }
      return application;
    });

  findStatusForCustomer = async (
    id: string,
    customerId: string,
  ): Promise<{ id: string; status: ApplicationStatus } | null> =>
    prisma.application.findFirst({
      where: { id, customerId },
      select: { id: true, status: true },
    });

  findForCustomer = async (
    id: string,
    customerId: string,
  ): Promise<ApplicationWithCalls | null> =>
    prisma.application.findFirst({
      where: { id, customerId },
      include: { upstreamCalls: { orderBy: { attempt: "asc" } } },
    });

  listForCustomer = async ({ customerId, limit, cursor }: ListPage): Promise<Application[]> => {
    const keyset = !cursor
      ? {}
      : cursor.id
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : { createdAt: { lt: cursor.createdAt } };

    return prisma.application.findMany({
      where: { customerId, ...keyset },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    });
  };

  saveDecision = async (id: string, update: DecisionUpdate): Promise<void> => {
    await prisma.application.update({
      where: { id },
      data: { ...update, claimedAt: null },
    });
  };

  markFailed = async (id: string): Promise<void> => {
    await prisma.application.update({
      where: { id },
      data: { status: "FAILED", claimedAt: null },
    });
  };

  countByStatus = async (status: ApplicationStatus): Promise<number> =>
    prisma.application.count({ where: { status } });

  oldestPendingCreatedAt = async (): Promise<Date | null> => {
    const row = await prisma.application.findFirst({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    });
    return row?.createdAt ?? null;
  };

  claimPending = async (batchSize: number): Promise<Application[]> => {
    const limit = Math.max(0, Math.trunc(batchSize));
    if (limit === 0) return [];

    return prisma.$queryRaw<Application[]>(Prisma.sql`
      UPDATE "Application"
      SET status = 'PROCESSING', "claimedAt" = now(), attempts = attempts + 1
      WHERE id IN (
        SELECT id FROM "Application"
        WHERE status = 'PENDING'
        ORDER BY "createdAt"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *
    `);
  };

  reapStale = async (maxAttempts: number, staleMs: number): Promise<number> => {
    const attempts = Math.max(0, Math.trunc(maxAttempts));
    const stale = Math.max(0, Math.trunc(staleMs));

    return prisma.$executeRaw(Prisma.sql`
      UPDATE "Application"
      SET status = CASE
                     WHEN attempts >= ${attempts} THEN 'FAILED'::"ApplicationStatus"
                     ELSE 'PENDING'::"ApplicationStatus"
                   END,
          "claimedAt" = NULL
      WHERE status = 'PROCESSING'
        AND "claimedAt" < now() - (${stale}::double precision * interval '1 millisecond')
    `);
  };

  ping = async (): Promise<void> => {
    await prisma.$queryRaw`SELECT 1`;
  };
}

export const applicationRepository = new ApplicationRepository();
