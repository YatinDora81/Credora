import * as React from "react";
import {
  AlertTriangle,
  ChevronRight,
  FileSearch,
  MousePointerClick,
  ShieldAlert,
  Siren,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ClauseOutcomeBadge,
  ResultBadge,
  StatusBadge,
  UpstreamOutcomeBadge,
} from "@/components/ui/status";
import { ApiError, getApplication, type ApplicationDetail } from "@/api";
import { cn, formatTs } from "@/lib/utils";

const POLL_MS = 2000;

export interface DecisionViewProps {
  apiKey: string;
  applicationId: string | null;
  onTerminal?: (id: string) => void;
}

export function DecisionView({ apiKey, applicationId, onTerminal }: DecisionViewProps) {
  const [detail, setDetail] = React.useState<ApplicationDetail | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const terminalRef = React.useRef(onTerminal);
  terminalRef.current = onTerminal;

  React.useEffect(() => {
    if (!applicationId) {
      setDetail(null);
      setError(null);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick(first: boolean) {
      if (cancelled || !applicationId) return;
      if (first) setLoading(true);
      try {
        const d = await getApplication(apiKey, applicationId);
        if (cancelled) return;
        setDetail(d);
        setError(null);
        if (d.status === "PROCESSING") {
          timer = setTimeout(() => tick(false), POLL_MS);
        } else {
          terminalRef.current?.(d.application_id);
        }
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof ApiError ? `${e.status} ${e.message}` : String(e);
        setError(msg);
      } finally {
        if (!cancelled && first) setLoading(false);
      }
    }

    setDetail(null);
    tick(true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [apiKey, applicationId]);

  if (!applicationId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>3 · Decision</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="flex items-center gap-2 pb-2 text-sm text-muted-foreground">
            <MousePointerClick className="h-4 w-4" />
            Select an application above to see how it was decided.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (error && !detail) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>3 · Decision</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="pb-2 text-sm text-red-600 dark:text-red-400">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!detail) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>3 · Decision</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="flex items-center gap-2 pb-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" />
            {loading ? "Loading…" : "…"}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>3 · Decision</CardTitle>
        <CardDescription className="font-mono text-xs">
          {detail.application_id}
          {detail.application_id_external ? ` · ${detail.application_id_external}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <OutcomeHeader detail={detail} />
        {detail.status === "PROCESSING" ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" />
            The worker has not finished. This view refreshes every 2 seconds.
          </p>
        ) : (
          <>
            <Separator />
            <ClauseSection detail={detail} />
            <Separator />
            <UpstreamSection calls={detail.upstream_calls ?? []} />
            <Separator />
            <ExtractionSection detail={detail} />
            <Separator />
            <HashFooter detail={detail} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function OutcomeHeader({ detail }: { detail: ApplicationDetail }) {
  const policy = detail.policy;
  const pinned = policy?.version ?? null;
  const active = policy?.active_version_now ?? null;
  const drifted = !!pinned && !!active && pinned !== active;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <StatusBadge status={detail.status} size="xl" />
        {policy ? (
          <p className="text-sm">
            Decided under{" "}
            <span className="font-mono font-semibold">
              {policy.customer} {policy.version}
            </span>
            {drifted ? (
              <span className="ml-1.5 font-mono text-amber-700 dark:text-amber-300">
                (currently active: {active})
              </span>
            ) : null}
          </p>
        ) : null}
        <p className="ml-auto text-xs text-muted-foreground">
          created {formatTs(detail.created_at)}
          {detail.decided_at ? ` · decided ${formatTs(detail.decided_at)}` : ""}
        </p>
      </div>

      {drifted ? (
        <p className="text-xs text-muted-foreground">
          The version was pinned when the application was accepted and is never re-read.
          The active version has moved on since; this decision did not.
        </p>
      ) : null}

      {detail.degraded ? (
        <div className="rounded-md border border-amber-600/45 bg-amber-500/10 px-3 py-2.5">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
            <AlertTriangle className="h-4 w-4" />
            Degraded — decided on incomplete evidence
          </p>
          <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-sm text-amber-800/90 dark:text-amber-200/90">
            {(detail.degraded_reasons ?? []).map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {detail.status === "FAILED" && detail.error ? (
        <div className="rounded-md border border-border bg-muted px-3 py-2.5 text-sm">
          <span className="font-semibold">Failure: </span>
          <span className="font-mono text-xs">{detail.error}</span>
        </div>
      ) : null}
    </section>
  );
}

function ClauseSection({ detail }: { detail: ApplicationDetail }) {
  const reasons = detail.reasons ?? [];
  return (
    <section className="space-y-3">
      <SectionTitle n={2} title="Clauses" sub={`${reasons.length} evaluated`} />
      {reasons.length === 0 ? (
        <p className="text-sm text-muted-foreground">No clause results recorded.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[4.5rem]">Clause</TableHead>
              <TableHead className="w-[10rem]">Result</TableHead>
              <TableHead className="w-[7rem]">Outcome</TableHead>
              <TableHead className="w-[36%]">Clause text</TableHead>
              <TableHead>Explanation</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reasons.map((r) => (
              <TableRow key={r.clause_id}>
                <TableCell className="font-mono text-xs font-semibold">
                  {r.clause_id}
                </TableCell>
                {}
                <TableCell>
                  <ResultBadge result={r.result} />
                </TableCell>
                <TableCell>
                  <ClauseOutcomeBadge outcome={r.outcome} />
                </TableCell>
                {}
                <TableCell className="text-xs leading-relaxed text-muted-foreground">
                  {r.clause_text}
                </TableCell>
                <TableCell className="text-xs leading-relaxed">
                  {r.explanation}
                  {r.evidence_refs?.length ? (
                    <span className="mt-1.5 flex flex-wrap gap-1">
                      {r.evidence_refs.map((e) => (
                        <span
                          key={e}
                          className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                        >
                          {e}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  {r.missing_inputs?.length ? (
                    <span className="mt-1 block font-mono text-[10px] text-amber-700 dark:text-amber-300">
                      missing: {r.missing_inputs.join(", ")}
                    </span>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {detail.policy?.resolved ? (
        <Collapsible label="Resolved policy — every clause with its on_fail / on_undetermined">
          <pre className="max-h-[28rem] overflow-auto scrollbar-thin rounded-md border border-border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
            {JSON.stringify(detail.policy.resolved, null, 2)}
          </pre>
        </Collapsible>
      ) : null}
    </section>
  );
}

function UpstreamSection({ calls }: { calls: NonNullable<ApplicationDetail["upstream_calls"]> }) {
  const breakerRows = calls.filter((c) => c.outcome === "CIRCUIT_OPEN").length;
  return (
    <section className="space-y-3">
      <SectionTitle
        n={3}
        title="Upstream calls"
        sub={
          calls.length === 0
            ? "none recorded"
            : `${calls.length} attempt${calls.length === 1 ? "" : "s"}${
                breakerRows ? ` · ${breakerRows} refused by the breaker` : ""
              }`
        }
      />
      {calls.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No upstream attempt was recorded for this application.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[5rem]">Attempt</TableHead>
              <TableHead className="w-[11rem]">Outcome</TableHead>
              <TableHead className="w-[7rem]">Duration</TableHead>
              <TableHead className="w-[6rem]">Status</TableHead>
              <TableHead className="w-[7rem]">Retry-After</TableHead>
              <TableHead>Started</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {calls.map((c, i) => {
              const breaker = c.outcome === "CIRCUIT_OPEN";
              return (
                <TableRow
                  key={`${c.attempt}-${i}`}
                  className={cn(
                    breaker &&
                      "border-l-4 border-l-violet-500 bg-violet-500/10 dark:bg-violet-500/15",
                  )}
                >
                  <TableCell className="font-mono text-xs">{c.attempt}</TableCell>
                  <TableCell>
                    <UpstreamOutcomeBadge outcome={c.outcome} />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{c.duration_ms} ms</TableCell>
                  <TableCell className="font-mono text-xs">
                    {c.status_code ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {c.retry_after_sec != null ? `${c.retry_after_sec}s` : "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatTs(c.started_at)}
                    {breaker ? (
                      <span className="mt-0.5 block text-[11px] font-medium text-violet-700 dark:text-violet-300">
                        circuit open — no request was sent
                      </span>
                    ) : null}
                    {c.error ? (
                      <span className="mt-0.5 block font-mono text-[10px] opacity-80">
                        {c.error}
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function ExtractionSection({ detail }: { detail: ApplicationDetail }) {
  const x = detail.extraction;

  if (!x) {
    return (
      <section className="space-y-3">
        <SectionTitle n={4} title="Extraction" sub="not recorded" />
        <p className="text-sm text-muted-foreground">
          No extraction envelope was recorded for this application.
        </p>
      </section>
    );
  }

  const fields = x.fields ?? [];
  const ungrounded = x.ungrounded ?? [];
  const concerns = x.concerns ?? [];

  return (
    <section className="space-y-3">
      <SectionTitle
        n={4}
        title="Extraction"
        sub={
          x.available
            ? `${fields.length} grounded · ${ungrounded.length} discarded · ${concerns.length} concern${
                concerns.length === 1 ? "" : "s"
              }${x.model ? ` · ${x.model}` : ""}${x.cached ? " · cached" : ""}`
            : "unavailable"
        }
      />

      {!x.available ? (
        <div className="rounded-md border border-amber-600/45 bg-amber-500/10 px-3 py-2.5">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
            <FileSearch className="h-4 w-4" />
            Model unavailable — {x.reason ?? "unknown reason"}
          </p>
          <p className="mt-1 text-xs text-amber-800/90 dark:text-amber-200/90">
            Clauses that needed an extracted fact are UNDETERMINED, not failed. The model
            decides nothing either way.
          </p>
        </div>
      ) : (
        <>
          {fields.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Extraction succeeded and returned no fields — there was nothing in the note or
              the document to ground.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[14rem]">Field</TableHead>
                  <TableHead className="w-[16rem]">Value</TableHead>
                  <TableHead>Quote it was grounded in</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fields.map((f) => (
                  <TableRow key={f.name}>
                    <TableCell className="font-mono text-xs">{f.name}</TableCell>
                    <TableCell className="font-mono text-xs font-semibold">
                      {f.value}
                    </TableCell>
                    <TableCell className="text-xs italic text-muted-foreground">
                      “{f.provenance?.quote ?? "—"}”
                      {f.provenance?.source ? (
                        <span className="ml-1.5 not-italic opacity-70">
                          ({f.provenance.source})
                        </span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {ungrounded.length ? (
            <div className="rounded-md border border-dashed border-border bg-muted/30 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Ungrounded — asserted by model, not found in source — discarded
              </p>
              <ul className="mt-2 space-y-1.5">
                {ungrounded.map((u, i) => (
                  <li key={`${u.name}-${i}`} className="text-xs text-muted-foreground">
                    <span className="font-mono line-through">{u.name}</span>{" "}
                    <span className="font-mono line-through opacity-80">= {u.value}</span>
                    <span className="ml-2 italic line-through opacity-70">“{u.quote}”</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      )}

      {concerns.length ? (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Concerns — surfaced, never scored
          </p>
          {concerns.map((c, i) => {
            const injection = c.code === "PROMPT_INJECTION_ATTEMPT";
            return (
              <div
                key={`${c.code}-${i}`}
                className={cn(
                  "rounded-md border px-3 py-2.5",
                  injection
                    ? "border-red-600/60 bg-red-500/10"
                    : "border-border bg-muted/30",
                )}
              >
                <p
                  className={cn(
                    "flex items-center gap-2 text-sm font-semibold",
                    injection ? "text-red-700 dark:text-red-300" : "",
                  )}
                >
                  {injection ? (
                    <Siren className="h-4 w-4" />
                  ) : (
                    <ShieldAlert className="h-4 w-4 opacity-70" />
                  )}
                  {c.code}
                </p>
                <p
                  className={cn(
                    "mt-1 text-xs",
                    injection ? "text-red-700/90 dark:text-red-300/90" : "text-muted-foreground",
                  )}
                >
                  {c.detail}
                </p>
                {c.quote ? (
                  <p className="mt-1 font-mono text-[11px] italic opacity-80">“{c.quote}”</p>
                ) : null}
                {injection ? (
                  <p className="mt-1.5 text-[11px] font-medium text-red-700 dark:text-red-300">
                    The instruction was reported and ignored. It changed no clause and no
                    outcome.
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function HashFooter({ detail }: { detail: ApplicationDetail }) {
  return (
    <div className="flex flex-wrap gap-x-6 gap-y-1 font-mono text-[11px] text-muted-foreground">
      <span>evidence_hash: {detail.evidence_hash ?? "—"}</span>
      <span>policy_hash: {detail.policy_hash ?? "—"}</span>
    </div>
  );
}

function SectionTitle({ n, title, sub }: { n: number; title: string; sub?: string }) {
  return (
    <div className="flex items-baseline gap-3">
      <h3 className="text-sm font-semibold">
        <span className="mr-2 text-muted-foreground">{n}.</span>
        {title}
      </h3>
      {sub ? <span className="text-xs text-muted-foreground">{sub}</span> : null}
    </div>
  );
}

function Collapsible({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="group rounded-md border border-border bg-background">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground">
        <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
        {label}
      </summary>
      <div className="border-t border-border p-2">{children}</div>
    </details>
  );
}
