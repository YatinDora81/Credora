import { CopyButton } from "@/components/ui/copy-button";
import { CLAUSE_OUTCOME_LABEL, label } from "@/lib/labels";
import type { ApplicationDetail } from "@/api";
import { Collapsible, SectionHeading } from "./shared";

interface ResolvedClause {
  id: string;
  text: string;
  check?: string;
  on_fail?: string;
  on_undetermined?: string;
}

interface ResolvedPolicy {
  customer?: string;
  version?: string;
  cap_undetermined_at?: string | null;
  mark_degraded_only?: boolean;
  clauses: ResolvedClause[];
}

function asResolved(value: unknown): ResolvedPolicy | null {
  if (!value || typeof value !== "object") return null;
  const clauses = (value as { clauses?: unknown }).clauses;
  if (!Array.isArray(clauses)) return null;
  return value as ResolvedPolicy;
}

export function PolicyPanel({ detail, customerName }: { detail: ApplicationDetail; customerName: string }) {
  const policy = asResolved(detail.policy?.resolved);

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <SectionHeading meta={detail.policy ? `${detail.policy.customer}@${detail.policy.version}` : undefined}>
          Policy as applied
        </SectionHeading>
        {policy?.cap_undetermined_at ? (
          <p className="text-13 text-subtle">
            {customerName} caps undetermined clauses at{" "}
            <span className="text-fg">{label(CLAUSE_OUTCOME_LABEL, policy.cap_undetermined_at)}</span>: a
            clause that could not be checked can never reject on its own.
          </p>
        ) : null}
        {!policy ? (
          <p className="text-13 text-subtle">The resolved policy was not returned for this application.</p>
        ) : (
          <ul className="divide-y divide-line rounded border">
            {policy.clauses.map((c) => (
              <li
                key={c.id}
                className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-2.5 px-3 py-2.5 text-13"
              >
                <span className="font-mono font-medium text-fg">{c.id}</span>
                <div className="min-w-0">
                  <p className="text-fg">{c.text}</p>
                  <p className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-12 text-subtle">
                    <span className="whitespace-nowrap">
                      If it fails: <span className="text-fg">{label(CLAUSE_OUTCOME_LABEL, c.on_fail)}</span>
                    </span>
                    <span className="whitespace-nowrap">
                      If undetermined:{" "}
                      <span className="text-fg">{label(CLAUSE_OUTCOME_LABEL, c.on_undetermined)}</span>
                    </span>
                    {c.check ? <span className="min-w-0 break-all font-mono text-faint">{c.check}</span> : null}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <SectionHeading meta="Recompute these from the stored evidence to reproduce the decision.">
          Fingerprints
        </SectionHeading>
        <dl className="divide-y divide-line rounded border text-13">
          {(
            [
              ["Evidence", detail.evidence_hash ?? null],
              ["Policy", detail.policy_hash ?? null],
            ] as const
          ).map(([name, hash]) => (
            <div key={name} className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2">
              <dt className="text-subtle">{name}</dt>
              <dd className="min-w-0 break-all font-mono text-12 text-fg">{hash ?? "—"}</dd>
              {hash ? <CopyButton value={hash} label={`${name.toLowerCase()} hash`} /> : <span />}
            </div>
          ))}
        </dl>
      </section>

      {detail.policy?.resolved ? (
        <Collapsible summary="Raw policy document">
          <pre className="mt-1 max-h-[28rem] overflow-auto rounded border bg-bg p-3 font-mono text-12 leading-5 text-subtle scrollbar-thin">
            {JSON.stringify(detail.policy.resolved, null, 2)}
          </pre>
        </Collapsible>
      ) : null}
    </div>
  );
}
