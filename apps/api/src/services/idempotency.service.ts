import { canonicalStringify, sha256Hex } from "@credora/core";
import { idempotencyRepository } from "@credora/db";

export type IdempotencyLookup =
  | { kind: "proceed" }
  | { kind: "replay"; applicationId: string }
  | { kind: "conflict"; applicationId: string };

export class IdempotencyService {
  hash = (body: unknown): string => sha256Hex(canonicalStringify(body));

  lookup = async (
    customerId: string,
    key: string,
    hash: string,
  ): Promise<IdempotencyLookup> => {
    const record = await idempotencyRepository.find(customerId, key);
    if (!record) return { kind: "proceed" };
    if (record.requestHash !== hash) {
      return { kind: "conflict", applicationId: record.applicationId };
    }
    return { kind: "replay", applicationId: record.applicationId };
  };

  isUniqueViolation = (err: unknown): boolean =>
    typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

export const idempotencyService = new IdempotencyService();
