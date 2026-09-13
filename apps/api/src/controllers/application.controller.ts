import type { Request, Response } from "express";
import { z } from "zod";
import { logger, setContext } from "@deepvue/platform";
import { authMiddleware } from "../middleware/auth";
import { applicationService } from "../services/application.service";
import {
  serialiseAccepted,
  serialiseFull,
  serialiseInFlight,
  serialiseListItem,
} from "../serialise";

const ApplicationPayload = z.object({
  application_id_external: z.string().optional(),
  applied_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  business: z.object({
    legal_name: z.string().min(1),
    pan: z.string().regex(/^[A-Z]{5}\d{4}[A-Z]$/),
    gstin: z.string().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z]\d?[A-Z\d]Z[A-Z\d]$/),
    registered_address: z.string().min(1),
    declared_annual_turnover_inr: z.number().int().nonnegative(),
    sector: z.string(),
  }),
  loan: z.object({
    amount_inr: z.number().int().positive(),
    tenure_months: z.number().int().positive(),
    purpose: z.string(),
  }),
  unstructured: z.object({
    field_agent_note: z.string(),
    document_text: z.string(),
  }),
});

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function parseJsonBody(req: Request): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(typeof req.body === "string" ? req.body : "") };
  } catch {
    return { ok: false };
  }
}

export class ApplicationController {
  create = async (req: Request, res: Response): Promise<void> => {
    const customer = authMiddleware.customerOf(req);
    setContext({ customer_id: customer.id });

    const parsedBody = parseJsonBody(req);
    if (!parsedBody.ok) {
      res.status(400).json({ error: "invalid_json" });
      return;
    }

    const parsed = ApplicationPayload.safeParse(parsedBody.value);
    if (!parsed.success) {
      logger.warn(
        { customer_id: customer.id, issue_count: parsed.error.issues.length },
        "application.validation_failed",
      );
      res.status(422).json({ error: "validation_failed", issues: parsed.error.issues });
      return;
    }

    const result = await applicationService.submit({
      customer,
      raw: parsedBody.value,
      payload: parsed.data,
      idempotencyKey: req.header("Idempotency-Key")?.trim() || null,
    });

    switch (result.kind) {
      case "conflict":
        res.status(409).json({ error: "idempotency_key_reuse" });
        return;
      case "policy_missing":
        res.status(500).json({
          error: "policy_not_available",
          detail: `No policy document for ${result.policyCustomerKey}@${result.version}.`,
        });
        return;
      case "replayed":
        res
          .status(200)
          .json(
            result.status
              ? serialiseAccepted({ id: result.applicationId, status: result.status })
              : { application_id: result.applicationId, status: "PROCESSING" },
          );
        return;
      case "created":
        res.status(202).json({ application_id: result.application.id, status: "PROCESSING" });
        return;
    }
  };

  list = async (req: Request, res: Response): Promise<void> => {
    const customer = authMiddleware.customerOf(req);
    setContext({ customer_id: customer.id });

    const limitRaw = req.query.limit;
    let limit = DEFAULT_LIMIT;
    if (typeof limitRaw === "string" && limitRaw !== "") {
      const n = Number(limitRaw);
      if (!Number.isFinite(n) || n < 1) {
        res.status(400).json({ error: "invalid_limit", detail: "limit must be a positive integer" });
        return;
      }
      limit = Math.min(Math.trunc(n), MAX_LIMIT);
    }

    const cursorRaw = req.query.cursor;
    let cursor: { createdAt: Date; id: string | null } | null = null;
    if (typeof cursorRaw === "string" && cursorRaw !== "") {
      const pipe = cursorRaw.lastIndexOf("|");
      const tsPart = pipe >= 0 ? cursorRaw.slice(0, pipe) : cursorRaw;
      const idPart = pipe >= 0 ? cursorRaw.slice(pipe + 1) : null;
      const at = new Date(tsPart);
      if (Number.isNaN(at.getTime())) {
        res.status(400).json({
          error: "invalid_cursor",
          detail: "cursor must be the next_cursor of the previous page",
        });
        return;
      }
      cursor = { createdAt: at, id: idPart && idPart.length > 0 ? idPart : null };
    }

    const { items, nextCursor } = await applicationService.list(customer, limit, cursor);
    res.json({ items: items.map(serialiseListItem), next_cursor: nextCursor });
  };

  show = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const customer = authMiddleware.customerOf(req);
    const id = req.params.id ?? "";
    setContext({ application_id: id, customer_id: customer.id });

    const result = await applicationService.get(customer, id);

    switch (result.kind) {
      case "not_found":
        res.status(404).json({ error: "not_found" });
        return;
      case "in_flight":
        res.json(serialiseInFlight(result.application));
        return;
      case "decided":
        res.json(
          serialiseFull(result.application, {
            activeVersionNow: result.activeVersionNow,
            resolvedPolicy: result.resolvedPolicy,
            upstreamCalls: result.application.upstreamCalls,
          }),
        );
        return;
    }
  };
}

export const applicationController = new ApplicationController();
