import { Prisma } from "@prisma/client";
import { prisma } from "../client";

export class ExtractionCacheRepository {
  find = async (inputHash: string): Promise<unknown | null> => {
    const row = await prisma.extractionCache.findUnique({ where: { inputHash } });
    return row?.extraction ?? null;
  };

  save = async (
    inputHash: string,
    model: string,
    extraction: Prisma.InputJsonValue,
  ): Promise<void> => {
    await prisma.extractionCache.upsert({
      where: { inputHash },
      update: { model, extraction },
      create: { inputHash, model, extraction },
    });
  };
}

export const extractionCacheRepository = new ExtractionCacheRepository();
