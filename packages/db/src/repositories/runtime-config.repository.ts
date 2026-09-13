import { prisma } from "../client";

export class RuntimeConfigRepository {
  get = async (key: string): Promise<string | null> => {
    const row = await prisma.runtimeConfig.findUnique({ where: { key } });
    return row?.value ?? null;
  };

  set = async (key: string, value: string): Promise<void> => {
    await prisma.runtimeConfig.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  };
}

export const runtimeConfigRepository = new RuntimeConfigRepository();
