import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { ClauseOutcome } from "../types";
import type { Clause, Policy, PolicyFile } from "./types";
import { CHECKS } from "./checks";

const HERE: string =
  typeof import.meta.dir === "string" ? import.meta.dir : dirname(fileURLToPath(import.meta.url));

const POLICY_DIR = join(HERE, "..", "policies");

const VALID_OUTCOMES: ClauseOutcome[] = ["APPROVE", "REVIEW", "REJECT"];

const CACHE = new Map<string, Policy>();

function cacheKey(customerKey: string, version: string): string {
  return `${customerKey}@${version}`;
}

function policyPath(customerKey: string, version: string): string {
  return join(POLICY_DIR, `${cacheKey(customerKey, version)}.yaml`);
}

function readPolicyFile(customerKey: string, version: string): PolicyFile {
  let raw: string;
  try {
    raw = readFileSync(policyPath(customerKey, version), "utf8");
  } catch {
    throw new Error(`Policy not found: ${cacheKey(customerKey, version)}`);
  }
  const parsed = parseYaml(raw) as PolicyFile | null;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Policy ${cacheKey(customerKey, version)} is empty or not a YAML mapping.`);
  }
  return parsed;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function mergeClause(parent: Clause, override: Partial<Clause>): Clause {
  const merged: Clause = {
    ...parent,
    ...override,
    id: parent.id,
    params: { ...parent.params, ...(isPlainObject(override.params) ? override.params : {}) },
  };
  if (override.applies_when) {
    merged.applies_when = {
      check: override.applies_when.check ?? parent.applies_when?.check ?? "",
      params: {
        ...(parent.applies_when?.params ?? {}),
        ...(override.applies_when.params ?? {}),
      },
    };
  } else if (parent.applies_when) {
    merged.applies_when = {
      check: parent.applies_when.check,
      params: { ...parent.applies_when.params },
    };
  }
  return merged;
}

function resolve(customerKey: string, version: string, chain: string[]): Policy {
  const key = cacheKey(customerKey, version);
  if (chain.includes(key)) {
    throw new Error(`Policy extends cycle detected: ${[...chain, key].join(" -> ")}`);
  }

  const file = readPolicyFile(customerKey, version);
  if (typeof file.customer !== "string" || file.customer.length === 0) {
    throw new Error(`Policy ${key} is missing "customer".`);
  }
  if (file.version === undefined || file.version === null) {
    throw new Error(`Policy ${key} is missing "version".`);
  }
  const declaredVersion = String(file.version);

  let clauses: Clause[];
  let capUndeterminedAt = file.cap_undetermined_at;
  let markDegradedOnly = file.mark_degraded_only;

  if (file.extends) {
    if (file.clauses) {
      throw new Error(
        `Policy ${key} declares both "extends" and "clauses". A child policy supplies "overrides" only.`,
      );
    }
    const spec = String(file.extends);
    const [parentCustomer, parentVersion] = spec.includes("@")
      ? [spec.slice(0, spec.indexOf("@")), spec.slice(spec.indexOf("@") + 1)]
      : [file.customer, spec];
    const parent = resolve(parentCustomer, parentVersion, [...chain, key]);

    const overrides = file.overrides ?? {};
    const parentIds = new Set(parent.clauses.map((c) => c.id));
    for (const id of Object.keys(overrides)) {
      if (!parentIds.has(id)) {
        throw new Error(
          `Policy ${key} overrides clause "${id}", which does not exist in parent ${parent.customer}@${parent.version}.`,
        );
      }
    }

    clauses = parent.clauses.map((c) => {
      const ov = overrides[c.id];
      return ov ? mergeClause(c, ov) : mergeClause(c, {});
    });

    if (capUndeterminedAt === undefined) capUndeterminedAt = parent.cap_undetermined_at;
    if (markDegradedOnly === undefined) markDegradedOnly = parent.mark_degraded_only;
  } else {
    if (!Array.isArray(file.clauses) || file.clauses.length === 0) {
      throw new Error(`Policy ${key} has no clauses.`);
    }
    clauses = file.clauses.map((c) => mergeClause(c, {}));
  }

  const policy: Policy = {
    customer: file.customer,
    version: declaredVersion,
    ...(file.extends ? { extends: String(file.extends) } : {}),
    ...(capUndeterminedAt !== undefined ? { cap_undetermined_at: capUndeterminedAt } : {}),
    ...(markDegradedOnly !== undefined ? { mark_degraded_only: markDegradedOnly } : {}),
    clauses,
  };

  validatePolicy(policy, key);
  return policy;
}

function validatePolicy(policy: Policy, key: string): void {
  if (policy.cap_undetermined_at !== undefined && !VALID_OUTCOMES.includes(policy.cap_undetermined_at)) {
    throw new Error(
      `Policy ${key} has invalid cap_undetermined_at "${String(policy.cap_undetermined_at)}"; expected one of ${VALID_OUTCOMES.join(" | ")}.`,
    );
  }

  const seen = new Set<string>();
  for (const clause of policy.clauses) {
    if (typeof clause.id !== "string" || clause.id.length === 0) {
      throw new Error(`Policy ${key} has a clause with no id.`);
    }
    if (seen.has(clause.id)) {
      throw new Error(`Policy ${key} declares clause "${clause.id}" more than once.`);
    }
    seen.add(clause.id);

    const where = `Policy ${key} clause ${clause.id}`;

    if (typeof clause.text !== "string" || clause.text.length === 0) {
      throw new Error(`${where} has no text.`);
    }
    if (typeof clause.check !== "string" || clause.check.length === 0) {
      throw new Error(`${where} names no check.`);
    }
    if (!(clause.check in CHECKS)) {
      throw new Error(
        `${where} names unknown check "${clause.check}". Known checks: ${Object.keys(CHECKS).sort().join(", ")}.`,
      );
    }
    if (!Array.isArray(clause.requires) || clause.requires.length === 0) {
      throw new Error(`${where} has an empty requires list; every clause must name its inputs.`);
    }
    for (const req of clause.requires) {
      if (typeof req !== "string" || req.length === 0) {
        throw new Error(`${where} has a non-string entry in requires.`);
      }
    }
    if (!isPlainObject(clause.params)) {
      throw new Error(`${where} has non-mapping params.`);
    }
    if (!VALID_OUTCOMES.includes(clause.on_fail)) {
      throw new Error(
        `${where} has invalid on_fail "${String(clause.on_fail)}"; expected one of ${VALID_OUTCOMES.join(" | ")}.`,
      );
    }
    if (!VALID_OUTCOMES.includes(clause.on_undetermined)) {
      throw new Error(
        `${where} has invalid on_undetermined "${String(clause.on_undetermined)}"; expected one of ${VALID_OUTCOMES.join(" | ")}.`,
      );
    }
    if (clause.applies_when) {
      const gate = clause.applies_when;
      if (typeof gate.check !== "string" || !(gate.check in CHECKS)) {
        throw new Error(
          `${where} applies_when names unknown check "${String(gate.check)}". Known checks: ${Object.keys(CHECKS).sort().join(", ")}.`,
        );
      }
      if (!isPlainObject(gate.params)) {
        throw new Error(`${where} applies_when has non-mapping params.`);
      }
    }
  }
}

export function loadPolicy(customerKey: string, version: string): Policy {
  const key = cacheKey(customerKey, version);
  const cached = CACHE.get(key);
  if (cached) return cached;
  const policy = resolve(customerKey, version, []);
  CACHE.set(key, policy);
  return policy;
}

export function listPolicies(): { customer: string; version: string }[] {
  return readdirSync(POLICY_DIR)
    .filter((name) => name.endsWith(".yaml"))
    .map((name) => {
      const base = name.slice(0, -".yaml".length);
      const at = base.lastIndexOf("@");
      return { customer: base.slice(0, at), version: base.slice(at + 1) };
    })
    .filter((p) => p.customer.length > 0 && p.version.length > 0)
    .sort((a, b) =>
      a.customer === b.customer
        ? a.version.localeCompare(b.version)
        : a.customer.localeCompare(b.customer),
    );
}

export function policyExists(customerKey: string, version: string): boolean {
  if (CACHE.has(cacheKey(customerKey, version))) return true;
  return listPolicies().some((p) => p.customer === customerKey && p.version === version);
}

export function validateAllPolicies(): Policy[] {
  return listPolicies().map((p) => loadPolicy(p.customer, p.version));
}
