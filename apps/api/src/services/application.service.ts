import type { Application, ApplicationStatus, Customer } from "@deepvue/db";
import { applicationRepository } from "@deepvue/db";
import type { ApplicationWithCalls } from "@deepvue/db";
import { loadPolicy, policyExists } from "@deepvue/core";
import type { Policy } from "@deepvue/core";
import { config, logger, setContext } from "@deepvue/platform";
import { idempotencyService } from "./idempotency.service";

const DEFAULT_DEADLINE_MS = 60_000;

export interface SubmitInput {
  customer: Customer;

  raw: unknown;
  payload: {
    application_id_external?: string;
    applied_on: string;
  } & Record<string, unknown>;
  idempotencyKey: string | null;
}

export type SubmitResult =
  | { kind: "created"; application: Application }
  | { kind: "replayed"; applicationId: string; status: ApplicationStatus | null }
  | { kind: "conflict" }
  | { kind: "policy_missing"; policyCustomerKey: string; version: string };

export type GetResult =
  | { kind: "not_found" }
  | { kind: "in_flight"; application: ApplicationWithCalls }
  | {
      kind: "decided";
      application: ApplicationWithCalls;
      activeVersionNow: string;
      resolvedPolicy: Policy | null;
    };

const TERMINAL: ReadonlySet<string> = new Set(["APPROVED", "REVIEW", "REJECTED", "FAILED"]);

export class ApplicationService {
  submit = async ({ customer, raw, payload, idempotencyKey }: SubmitInput): Promise<SubmitResult> => {
    const hash = idempotencyKey ? idempotencyService.hash(raw) : null;

    if (idempotencyKey && hash) {
      const found = await idempotencyService.lookup(customer.id, idempotencyKey, hash);
      if (found.kind === "conflict") {
        logger.warn(
          { customer_id: customer.id, application_id: found.applicationId },
          "application.idempotency_key_reuse",
        );
        return { kind: "conflict" };
      }
      if (found.kind === "replay") {
        setContext({ application_id: found.applicationId });
        logger.info(
          { application_id: found.applicationId, customer_id: customer.id },
          "application.idempotent_replay",
        );
        return this.replayOf(customer, found.applicationId);
      }
    }

    const version = await this.activeVersion(customer);

    if (!policyExists(customer.policyCustomerKey, version)) {
      logger.error(
        {
          customer_id: customer.id,
          policy_customer: customer.policyCustomerKey,
          policy_version: version,
        },
        "application.policy_missing",
      );
      return { kind: "policy_missing", policyCustomerKey: customer.policyCustomerKey, version };
    }

    const deadlineMs = await config.getInt("APPLICATION_DEADLINE_MS", DEFAULT_DEADLINE_MS);

    try {
      const application = await applicationRepository.create(
        {
          customerId: customer.id,
          externalId: payload.application_id_external ?? null,
          appliedOn: new Date(`${payload.applied_on}T00:00:00.000Z`),
          payload: payload as object,

          policyCustomerKey: customer.policyCustomerKey,
          policyVersion: version,
          deadlineAt: new Date(Date.now() + deadlineMs),
        },
        idempotencyKey && hash ? { key: idempotencyKey, requestHash: hash } : null,
      );

      setContext({ application_id: application.id });
      logger.info(
        {
          application_id: application.id,
          customer_id: customer.id,
          policy_version: application.policyVersion,
        },
        "application.received",
      );

      return { kind: "created", application };
    } catch (err) {
      if (idempotencyKey && hash && idempotencyService.isUniqueViolation(err)) {
        const raced = await idempotencyService.lookup(customer.id, idempotencyKey, hash);
        if (raced.kind === "replay") {
          logger.info(
            { application_id: raced.applicationId, customer_id: customer.id },
            "application.idempotency_race_resolved",
          );
          return this.replayOf(customer, raced.applicationId);
        }
        if (raced.kind === "conflict") return { kind: "conflict" };
      }
      throw err;
    }
  };

  list = async (
    customer: Customer,
    limit: number,
    cursor: { createdAt: Date; id: string | null } | null,
  ): Promise<{ items: Application[]; nextCursor: string | null }> => {
    const items = await applicationRepository.listForCustomer({
      customerId: customer.id,
      limit,
      cursor,
    });
    const last = items.length === limit ? items[items.length - 1] : undefined;
    return {
      items,
      nextCursor: last ? `${last.createdAt.toISOString()}|${last.id}` : null,
    };
  };

  get = async (customer: Customer, id: string): Promise<GetResult> => {
    const application = await applicationRepository.findForCustomer(id, customer.id);

    if (!application) return { kind: "not_found" };

    if (!TERMINAL.has(application.status)) return { kind: "in_flight", application };

    let resolvedPolicy: Policy | null = null;
    try {
      resolvedPolicy = loadPolicy(application.policyCustomerKey, application.policyVersion);
    } catch (err) {
      logger.warn(
        { application_id: application.id, policy_version: application.policyVersion, err },
        "application.pinned_policy_unloadable",
      );
    }

    return {
      kind: "decided",
      application,
      activeVersionNow: await this.activeVersion(customer),
      resolvedPolicy,
    };
  };

  private activeVersion = async (customer: Customer): Promise<string> =>
    (await config.get(customer.activeVersionEnv)) ?? customer.fallbackVersion;

  private replayOf = async (customer: Customer, applicationId: string): Promise<SubmitResult> => {
    const existing = await applicationRepository.findStatusForCustomer(applicationId, customer.id);
    return { kind: "replayed", applicationId, status: existing?.status ?? null };
  };
}

export const applicationService = new ApplicationService();
