import type { Request, Response } from "express";
import { healthService } from "../services/health.service";
import { keepaliveService } from "../services/keepalive.service";

export class HealthController {
  show = async (_req: Request, res: Response): Promise<void> => {
    res.json(await healthService.snapshot());
  };

  keepalive = async (_req: Request, res: Response): Promise<void> => {
    res.setHeader("Cache-Control", "no-store");
    res.json(await keepaliveService.check());
  };
}

export const healthController = new HealthController();
