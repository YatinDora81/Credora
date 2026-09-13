import type { Customer } from "@deepvue/db";
import { canonicalStringify, listPolicies, loadPolicy, policyHash, type Policy } from "@deepvue/core";
import { config, logger } from "@deepvue/platform";

export type ActiveVersionSource = "db" | "env" | "default" | "fallback";

export interface PolicyVersionView {
  version: string;
  active: boolean;
  extends: string | null;
  changed_clauses: string[];
  policy_hash: string;
  policy: Policy;
}

export interface PolicyCatalog {
  customer: { id: string; name: string; policy_key: string };
  active_version: string;
  active_version_key: string;
  active_version_source: ActiveVersionSource;
  active_version_available: boolean;
  versions: PolicyVersionView[];
}

function compareVersions(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

function parentOf(policy: Policy): { customer: string; version: string } | null {
  if (!policy.extends) return null;
  const spec = policy.extends;
  const at = spec.indexOf("@");
  return at >= 0
    ? { customer: spec.slice(0, at), version: spec.slice(at + 1) }
    : { customer: policy.customer, version: spec };
}

function changedClauses(policy: Policy): string[] {
  const parent = parentOf(policy);
  if (!parent) return [];
  const before = new Map(
    loadPolicy(parent.customer, parent.version).clauses.map((c) => [c.id, canonicalStringify(c)]),
  );
  return policy.clauses
    .filter((c) => before.get(c.id) !== canonicalStringify(c))
    .map((c) => c.id);
}

export class PolicyService {
  catalogFor = async (customer: Customer): Promise<PolicyCatalog> => {
    const configured = await config.getWithSource(customer.activeVersionEnv);
    const activeVersion = configured.value ?? customer.fallbackVersion;
    const source: ActiveVersionSource =
      configured.value === undefined || configured.source === "unset" ? "fallback" : configured.source;

    const versions: PolicyVersionView[] = [];
    const available = listPolicies()
      .filter((p) => p.customer === customer.policyCustomerKey)
      .map((p) => p.version)
      .sort(compareVersions);

    for (const version of available) {
      try {
        const policy = loadPolicy(customer.policyCustomerKey, version);
        versions.push({
          version,
          active: version === activeVersion,
          extends: policy.extends ?? null,
          changed_clauses: changedClauses(policy),
          policy_hash: policyHash(policy),
          policy,
        });
      } catch (err) {
        logger.error(
          { err, customer_id: customer.id, policy_version: version },
          "policy.catalog_version_unloadable",
        );
      }
    }

    return {
      customer: { id: customer.id, name: customer.name, policy_key: customer.policyCustomerKey },
      active_version: activeVersion,
      active_version_key: customer.activeVersionEnv,
      active_version_source: source,
      active_version_available: versions.some((v) => v.active),
      versions,
    };
  };
}

export const policyService = new PolicyService();
