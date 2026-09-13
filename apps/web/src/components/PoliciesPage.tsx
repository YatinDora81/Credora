import * as React from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { CopyButton } from "@/components/ui/copy-button";
import { Dot, StatusGlyph } from "@/components/ui/status";
import { Tabs } from "@/components/ui/tabs";
import { ApiError, getPolicies, type ClauseOutcome, type PolicyCatalog, type PolicyClause, type PolicyVersionView } from "@/api";
import { CUSTOMERS, type Customer } from "@/fixtures";
import { CLAUSE_OUTCOME_LABEL, label } from "@/lib/labels";
import { cn } from "@/lib/utils";

const REFRESH_MS = 15_000;

type Entry = { data: PolicyCatalog | null; error: string | null };

const OUTCOME_STATUS: Record<ClauseOutcome, string> = {
  APPROVE: "APPROVED",
  REVIEW: "REVIEW",
  REJECT: "REJECTED",
};

function sourceText(c: PolicyCatalog): string {
  switch (c.active_version_source) {
    case "db":
      return "set by an admin override";
    case "env":
      return `set by environment variable ${c.active_version_key}`;
    case "default":
      return `built-in default for ${c.active_version_key}`;
    default:
      return "the customer's fallback version";
  }
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(formatValue).join(", ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatParams(params: Record<string, unknown> | undefined): string {
  if (!params) return "";
  return Object.entries(params)
    .map(([k, v]) => `${k.replace(/_/g, " ")} ${formatValue(v)}`)
    .join(" · ");
}

export function PoliciesPage() {
  const [entries, setEntries] = React.useState<Record<string, Entry>>({});
  const [customerId, setCustomerId] = React.useState<Customer["id"]>(CUSTOMERS[0]!.id);
  const [versionByCustomer, setVersionByCustomer] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    const results = await Promise.all(
      CUSTOMERS.map(async (c): Promise<[string, Entry]> => {
        try {
          return [c.id, { data: await getPolicies(c.apiKey), error: null }];
        } catch (e) {
          const message =
            e instanceof ApiError ? (e.body?.error ?? (e.status ? `HTTP ${e.status}` : "network error")) : String(e);
          return [c.id, { data: null, error: message }];
        }
      }),
    );
    setEntries((prev) => {
      const next = { ...prev };
      for (const [id, entry] of results) {
        next[id] = entry.data ? entry : { data: prev[id]?.data ?? null, error: entry.error };
      }
      return next;
    });
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void load();
    const t = setInterval(() => void load(), REFRESH_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const customer = CUSTOMERS.find((c) => c.id === customerId) ?? CUSTOMERS[0]!;
  const entry = entries[customer.id];
  const catalog = entry?.data ?? null;
  const selectedVersion =
    catalog?.versions.find((v) => v.version === versionByCustomer[customer.id]) ??
    catalog?.versions.find((v) => v.active) ??
    catalog?.versions[catalog.versions.length - 1] ??
    null;

  return (
    <div className="lg:grid lg:h-full lg:min-h-0 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <aside className="scrollbar-thin border-b lg:overflow-y-auto lg:border-b-0 lg:border-r">
        <div className="flex h-11 items-center gap-2 border-b px-4">
          <h1 className="text-14 font-semibold">Policies</h1>
          <span className="text-13 text-faint">{CUSTOMERS.length} customers</span>
          <button
            type="button"
            onClick={() => void load()}
            aria-label="Refresh policies"
            className="ml-auto flex h-7 w-7 items-center justify-center rounded text-faint hover:bg-hover hover:text-fg"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "motion-safe:animate-spin")} strokeWidth={2} />
          </button>
        </div>
        <nav aria-label="Customers" className="divide-y divide-line">
          {CUSTOMERS.map((c) => {
            const data = entries[c.id]?.data;
            const selected = c.id === customer.id;
            return (
              <button
                key={c.id}
                type="button"
                aria-current={selected ? "true" : undefined}
                onClick={() => setCustomerId(c.id)}
                className={cn(
                  "block w-full px-4 py-3 text-left hover:bg-hover focus-visible:-outline-offset-2",
                  selected && "bg-selected shadow-[inset_2px_0_0_0_oklch(var(--accent))] hover:bg-selected",
                )}
              >
                <span className="block text-14 font-medium text-fg">{c.name}</span>
                <span className="mt-0.5 block text-12 text-subtle">{c.posture}</span>
                <span className="mt-1.5 flex items-center gap-1.5 text-12">
                  {data ? (
                    <>
                      <Dot tone={data.active_version_available ? "approve" : "reject"} />
                      <span className="text-fg">v{data.active_version} active</span>
                      <span className="text-faint">
                        · {data.versions.length} version{data.versions.length === 1 ? "" : "s"}
                      </span>
                    </>
                  ) : entries[c.id]?.error ? (
                    <span className="text-reject">Could not load</span>
                  ) : (
                    <span className="text-faint">Loading…</span>
                  )}
                </span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main aria-label="Policy detail" className="scrollbar-thin lg:overflow-y-auto">
        <div className="mx-auto w-full max-w-[60rem] px-4 py-6 sm:px-8 lg:py-8">
          {!catalog ? (
            entry?.error ? (
              <p className="text-13 text-reject">
                Could not load {customer.name}&apos;s policies: {entry.error}
              </p>
            ) : (
              <div aria-busy className="space-y-3">
                <div className="h-6 w-48 rounded bg-selected" />
                <div className="h-3 w-80 rounded bg-hover" />
              </div>
            )
          ) : (
            <CustomerPolicies
              catalog={catalog}
              customer={customer}
              selected={selectedVersion}
              onSelectVersion={(v) => setVersionByCustomer((prev) => ({ ...prev, [customer.id]: v }))}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function CustomerPolicies({
  catalog,
  customer,
  selected,
  onSelectVersion,
}: {
  catalog: PolicyCatalog;
  customer: Customer;
  selected: PolicyVersionView | null;
  onSelectVersion: (version: string) => void;
}) {
  return (
    <article aria-labelledby="policy-customer" className="space-y-6">
      <header className="space-y-2">
        <p className="font-mono text-13 text-faint">{catalog.customer.policy_key}</p>
        <h2 id="policy-customer" className="text-20 font-semibold">
          {catalog.customer.name}
        </h2>
        <p className="text-13 text-subtle">{customer.posture}</p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-13">
          <Dot tone={catalog.active_version_available ? "approve" : "reject"} />
          <span className="text-fg">Active version v{catalog.active_version}</span>
          <span className="text-subtle">— {sourceText(catalog)}</span>
        </p>
        {!catalog.active_version_available ? (
          <p className="flex items-start gap-2 text-13 text-reject">
            <TriangleAlert className="mt-[3px] h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
            There is no policy file for v{catalog.active_version}. New applications for this customer
            will fail until the active version points at one of the versions below.
          </p>
        ) : null}
      </header>

      <div className="border-b">
        <Tabs
          idPrefix={`policy-${catalog.customer.id}`}
          value={selected?.version ?? ""}
          onChange={onSelectVersion}
          items={catalog.versions.map((v) => ({
            id: v.version,
            label: v.active ? `v${v.version} · Active` : `v${v.version}`,
          }))}
        />
      </div>

      {selected ? <VersionDetail catalog={catalog} view={selected} /> : null}
    </article>
  );
}

function VersionDetail({ catalog, view }: { catalog: PolicyCatalog; view: PolicyVersionView }) {
  const policy = view.policy;
  const changed = new Set(view.changed_clauses);
  const switchBody = JSON.stringify({ [catalog.active_version_key]: view.version });
  const switchCommand = `curl -X PUT ${window.location.origin}/v1/admin/config -H 'X-Admin-Key: <admin key>' -H 'Content-Type: application/json' -d '${switchBody}'`;

  return (
    <div
      role="tabpanel"
      id={`policy-${catalog.customer.id}-panel-${view.version}`}
      aria-labelledby={`policy-${catalog.customer.id}-tab-${view.version}`}
      className="space-y-6"
    >
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {view.active ? (
            <span className="inline-flex items-center gap-1.5 text-14 font-medium text-approve">
              <Dot tone="approve" />
              Active
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-14 font-medium text-subtle">
              <Dot tone="faint" />
              Not active
            </span>
          )}
          <span className="flex min-w-0 items-center gap-1 font-mono text-12 text-faint">
            <span className="truncate">{view.policy_hash.slice(0, 19)}…</span>
            <CopyButton value={view.policy_hash} label="policy hash" />
          </span>
        </div>

        <p className="text-13 text-fg">
          {view.active
            ? `New ${catalog.customer.name} applications are pinned to v${view.version} when they are accepted.`
            : `Available, but no new application uses it. Applications already accepted keep the version they were pinned to.`}
        </p>

        <dl className="grid gap-x-4 gap-y-2 text-13 sm:grid-cols-[10rem_minmax(0,1fr)]">
          {view.extends ? (
            <>
              <dt className="text-subtle">Based on</dt>
              <dd className="text-fg">
                v{view.extends.replace(/^.*@/, "")}
                {view.changed_clauses.length > 0
                  ? `, changing ${view.changed_clauses.join(", ")}`
                  : ", with no clause changes"}
              </dd>
            </>
          ) : null}
          <dt className="text-subtle">Missing inputs</dt>
          <dd className="text-fg">
            {policy.cap_undetermined_at
              ? `A clause that cannot be checked never produces more than ${label(CLAUSE_OUTCOME_LABEL, policy.cap_undetermined_at)}, so missing data cannot reject on its own.`
              : policy.mark_degraded_only
                ? "Never block a decision: it is made on what is available and marked degraded."
                : "Each clause applies its own outcome for undetermined."}
          </dd>
        </dl>

        {!view.active ? (
          <div className="space-y-1.5">
            <p className="text-12 text-subtle">To make this version active (admin key required):</p>
            <div className="flex items-start gap-2 rounded border bg-bg px-3 py-2">
              <code className="min-w-0 flex-1 break-all font-mono text-12 text-fg">{switchCommand}</code>
              <CopyButton value={switchCommand} label="command" />
            </div>
          </div>
        ) : null}
      </section>

      <section className="space-y-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-13 font-semibold text-fg">Clauses</h3>
          <span className="text-12 text-faint">{policy.clauses.length} evaluated for every application</span>
        </div>
        <ul className="divide-y divide-line rounded border">
          {policy.clauses.map((c) => (
            <ClauseRow key={c.id} clause={c} changed={changed.has(c.id)} parent={view.extends} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function ClauseRow({ clause: c, changed, parent }: { clause: PolicyClause; changed: boolean; parent: string | null }) {
  return (
    <li className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-2.5 px-3 py-3 text-13">
      <span className="font-mono font-medium leading-5 text-fg">{c.id}</span>
      <div className="min-w-0 space-y-1.5">
        <p className="text-fg">
          {c.text}
          {changed && parent ? (
            <span className="ml-2 whitespace-nowrap text-12 text-info">Changed from v{parent.replace(/^.*@/, "")}</span>
          ) : null}
        </p>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-12">
          <Outcome name="If it fails" outcome={c.on_fail} />
          <Outcome name="If undetermined" outcome={c.on_undetermined} />
        </p>
        <p className="break-words font-mono text-12 text-faint">
          {c.check}
          {formatParams(c.params) ? ` · ${formatParams(c.params)}` : ""}
          {c.requires.length ? ` · needs ${c.requires.join(", ")}` : ""}
        </p>
        {c.applies_when ? (
          <p className="text-12 text-subtle">
            Only applies when <span className="font-mono text-faint">{c.applies_when.check}</span>
            {formatParams(c.applies_when.params) ? ` (${formatParams(c.applies_when.params)})` : ""}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function Outcome({ name, outcome }: { name: string; outcome: ClauseOutcome }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="text-subtle">{name}</span>
      <StatusGlyph status={OUTCOME_STATUS[outcome]} size={13} />
      <span className="text-fg">{label(CLAUSE_OUTCOME_LABEL, outcome)}</span>
    </span>
  );
}
