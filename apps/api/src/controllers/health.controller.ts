import type { Request, Response } from "express";
import { healthService } from "../services/health.service";

export class HealthController {
  show = async (_req: Request, res: Response): Promise<void> => {
    res.json(await healthService.snapshot());
  };
}

export const healthController = new HealthController();
