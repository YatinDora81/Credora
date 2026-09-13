import type { Request, Response } from "express";
import { authMiddleware } from "../middleware/auth";
import { policyService } from "../services/policy.service";

export class PolicyController {
  list = async (req: Request, res: Response): Promise<void> => {
    const customer = authMiddleware.customerOf(req);
    res.json(await policyService.catalogFor(customer));
  };
}

export const policyController = new PolicyController();
