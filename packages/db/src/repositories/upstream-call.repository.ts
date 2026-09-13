import { prisma } from "../client";

export interface UpstreamCallInput {
  attempt: number;
  startedAt: Date;
  durationMs: number;
  outcome: string;
  statusCode: number | null;
  retryAfterSec: number | null;
  error: string | null;
}

export class UpstreamCallRepository {
  create = async (applicationId: string, call: UpstreamCallInput): Promise<void> => {
    await prisma.upstreamCall.create({ data: { applicationId, ...call } });
  };
}

export const upstreamCallRepository = new UpstreamCallRepository();
