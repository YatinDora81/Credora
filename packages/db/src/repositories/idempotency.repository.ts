import type { IdempotencyRecord } from "@prisma/client";
import { prisma } from "../client";

export class IdempotencyRepository {
  find = async (customerId: string, key: string): Promise<IdempotencyRecord | null> =>
    prisma.idempotencyRecord.findUnique({
      where: { customerId_key: { customerId, key } },
    });
}

export const idempotencyRepository = new IdempotencyRepository();
