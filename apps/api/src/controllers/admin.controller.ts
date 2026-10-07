import type { Request, Response } from "express";
import { OVERRIDABLE_KEYS } from "@credora/platform";
import { adminService } from "../services/admin.service";
import { parseJsonBody } from "./application.controller";

export class AdminController {
  show = async (_req: Request, res: Response): Promise<void> => {
    res.json({
      config: await adminService.effective(),
      overridable_keys: [...OVERRIDABLE_KEYS],
    });
  };

  update = async (req: Request, res: Response): Promise<void> => {
    const parsed = parseJsonBody(req);
    if (!parsed.ok) {
      res.status(400).json({ error: "invalid_json" });
      return;
    }

    const body = parsed.value;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      res
        .status(400)
        .json({ error: "invalid_body", detail: "expected a flat object of string values" });
      return;
    }

    const result = await adminService.update(Object.entries(body as Record<string, unknown>));

    switch (result.kind) {
      case "unknown_key":
        res.status(400).json({
          error: "unknown_config_key",
          key: result.key,
          detail: `"${result.key}" is not overridable at runtime.`,
          allowed: [...OVERRIDABLE_KEYS],
        });
        return;
      case "invalid_value":
        res
          .status(400)
          .json({ error: "invalid_config_value", key: result.key, detail: "values must be strings" });
        return;
      case "ok":
        res.json({
          ok: true,
          updated: result.updated,
          config: await adminService.effective(),
        });
        return;
    }
  };
}

export const adminController = new AdminController();
