import { runtimeConfigRepository } from "@deepvue/db";
import { OVERRIDABLE_KEYS, config, logger } from "@deepvue/platform";

export type EffectiveConfig = Record<string, { value: string | null; source: string }>;

export type UpdateResult =
  | { kind: "ok"; updated: Record<string, string> }
  | { kind: "unknown_key"; key: string }
  | { kind: "invalid_value"; key: string };

export class AdminService {
  effective = async (): Promise<EffectiveConfig> => {
    const out: EffectiveConfig = {};
    for (const key of OVERRIDABLE_KEYS) {
      const { value, source } = await config.getWithSource(key);
      out[key] = { value: value ?? null, source };
    }
    return out;
  };

  update = async (entries: [string, unknown][]): Promise<UpdateResult> => {
    for (const [key, value] of entries) {
      if (!config.isOverridableKey(key)) return { kind: "unknown_key", key };
      if (typeof value !== "string") return { kind: "invalid_value", key };
    }

    const updated: Record<string, string> = {};
    for (const [key, value] of entries as [string, string][]) {
      await runtimeConfigRepository.set(key, value);

      config.invalidate(key);
      updated[key] = value;
    }

    logger.info({ keys: Object.keys(updated) }, "admin.config_updated");
    return { kind: "ok", updated };
  };
}

export const adminService = new AdminService();
