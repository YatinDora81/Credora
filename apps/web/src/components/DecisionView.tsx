import * as React from "react";
import { ShieldAlert, TriangleAlert, WifiOff } from "lucide-react";
import { CopyButton } from "@/components/ui/copy-button";
import { ResultGlyph, StatusGlyph } from "@/components/ui/status";
import { Tabs, TabPanel } from "@/components/ui/tabs";
import { ApiError, getApplication, type ApplicationDetail, type Reason } from "@/api";
import { customerByKey, customerByPolicy } from "@/fixtures";
import { CLAUSE_OUTCOME_LABEL, STATUS_LABEL, label } from "@/lib/labels";
import { cn, durationBetween, formatMs, formatTs, shortId, useNow } from "@/lib/utils";
import { CallsPanel } from "./decision/CallsPanel";
import { ClausesPanel } from "./decision/ClausesPanel";
import { EvidencePanel } from "./decision/EvidencePanel";
import { PolicyPanel } from "./decision/PolicyPanel";
import { Banner, Collapsible, Quote, decidingClauses, realQuote } from "./decision/shared";

const POLL_MS = 2000;
const MAX_BACKOFF_MS = 10_000;

type TabId = "clauses" | "evidence" | "calls" | "policy";

export function DecisionView({
  apiKey,
  applicationId,
  onTerminal,
}: {
  apiKey: string;
  applicationId: string | null;
  onTerminal?: (id: string) => void;
}) {
  const [detail, setDetail] = React.useState<ApplicationDetail | null>(null);
  const [error, setError] = React.useState<{ message: string; notFound: boolean } | null>(null);
  const [tab, setTab] = React.useState<TabId>("clauses");
  const [announcement, setAnnouncement] = React.useState("");

  const terminalRef = React.useRef(onTerminal);
  terminalRef.current = onTerminal;

  React.useEffect(() => {
    setDetail(null);
    setError(null);
    setTab("clauses");
    setAnnouncement("");
    if (!applicationId) return;

    let cancelled = false;
    let previousStatus: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    async function tick() {
      try {
        const d = await getApplication(apiKey, applicationId!);
        if (cancelled) return;
        failures = 0;
        setDetail(d);
        setError(null);
        if (previousStatus === "PROCESSING" && d.status !== "PROCESSING") {
          setAnnouncement(
            `${d.application_id_external ?? shortId(d.application_id)} decided: ${label(STATUS_LABEL, d.status)}`,
          );
        }
        previousStatus = d.status;
        if (d.status === "PROCESSING") timer = setTimeout(tick, POLL_MS);
        else terminalRef.current?.(d.application_id);
      } catch (e) {
        if (cancelled) return;
        const notFound = e instanceof ApiError && e.status === 404;
        setError({
          message: e instanceof ApiError ? (e.body?.error ?? (e.status ? `HTTP ${e.status}` : "network error")) : String(e),
          notFound,
        });
        if (notFound) return;
        failures += 1;
        timer = setTimeout(tick, Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** Math.min(failures, 3)));
      }
    }

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [apiKey, applicationId]);

  const live = (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {announcement}
    </div>
  );

  if (!applicationId) return <EmptyDecision />;

  if (!detail) {
    if (error?.notFound) {
      return (
        <Shell>
          {live}
          <p className="text-14 font-medium">Application not found</p>
          <p className="mt-1 text-13 text-subtle">
            It does not exist for this customer. Applications are only visible to the API key that
            created them.
          </p>
        </Shell>
      );
    }
    return (
      <Shell>
        {live}
        <div aria-busy className="space-y-3">
          <div className="h-3 w-48 rounded bg-selected" />
          <div className="h-6 w-32 rounded bg-selected" />
          <div className="h-3 w-72 rounded bg-hover" />
          {error ? <p className="pt-2 text-13 text-reject">Could not load: {error.message}. Retrying…</p> : null}
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {live}
      {error ? (
        <p className="mb-4 flex items-center gap-2 text-12 text-review">
          <WifiOff className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          Lost contact with the API ({error.message}). Retrying…
        </p>
      ) : null}
      <DecisionDetail detail={detail} fallbackCustomer={customerByKey(apiKey).name} tab={tab} onTab={setTab} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-[56rem] px-4 py-6 sm:px-8 lg:py-8">{children}</div>;
}

function EmptyDecision() {
  return (
    <Shell>
      <div className="max-w-[34rem] pt-2">
        <p className="text-14 font-medium">No application selected</p>
        <p className="mt-1 text-13 text-subtle">
          Submit a scenario or pick an application from the list. The outcome appears here with every
          policy clause it was decided on, the evidence behind each one, and every call made to the
          registry.
        </p>
        <dl className="mt-6 grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-2 gap-y-2 text-13">
          {(["PASS", "FAIL", "UNDETERMINED", "NOT_APPLICABLE"] as const).map((r) => (
            <React.Fragment key={r}>
              <dt className="flex h-5 items-center">
                <ResultGlyph result={r} />
              </dt>
              <dd className="text-subtle">
                {
                  {
                    PASS: "Passed — the clause allows approval.",
                    FAIL: "Failed — the clause applies its on-fail outcome.",
                    UNDETERMINED: "Undetermined — an input was missing, so the clause's outcome for undetermined applies.",
                    NOT_APPLICABLE: "Not applicable — the clause does not cover this business.",
                  }[r]
                }
              </dd>
            </React.Fragment>
          ))}
        </dl>
      </div>
    </Shell>
  );
}

function DecisionDetail({
  detail,
  fallbackCustomer,
  tab,
  onTab,
}: {
  detail: ApplicationDetail;
  fallbackCustomer: string;
  tab: TabId;
  onTab: (t: TabId) => void;
}) {
  const processing = detail.status === "PROCESSING";
  const now = useNow(processing ? 1000 : 60_000);
  const customer = customerByPolicy(detail.policy?.customer);
  const customerName = customer?.name ?? detail.policy?.customer ?? fallbackCustomer;
  const reasons = detail.reasons ?? [];
  const deciding = decidingClauses(detail.status, reasons);
  const concerns = detail.extraction?.concerns ?? [];
  const injection = concerns.find((c) => c.code === "PROMPT_INJECTION_ATTEMPT");
  const calls = detail.upstream_calls ?? [];
  const failedCalls = calls.filter((c) => c.outcome !== "SUCCESS").length;
  const pinned = detail.policy?.version;
  const active = detail.policy?.active_version_now;
  const drifted = !!pinned && !!active && pinned !== active;
  const took = durationBetween(detail.created_at, detail.decided_at);
  const counts = {
    FAIL: reasons.filter((r) => r.result === "FAIL").length,
    UNDETERMINED: reasons.filter((r) => r.result === "UNDETERMINED").length,
    PASS: reasons.filter((r) => r.result === "PASS").length,
    NOT_APPLICABLE: reasons.filter((r) => r.result === "NOT_APPLICABLE").length,
  };
  const undeterminedOutcomes = [
    ...new Set(reasons.filter((r) => r.result === "UNDETERMINED").map((r) => r.outcome)),
  ];
  const unchecked = `${counts.UNDETERMINED} clause${counts.UNDETERMINED === 1 ? "" : "s"} could not be checked`;
  const degradedText =
    counts.UNDETERMINED === 0
      ? "Some inputs were unavailable when the policy was evaluated."
      : undeterminedOutcomes.length === 1
        ? `${unchecked}, so ${customerName}'s policy set ${counts.UNDETERMINED === 1 ? "it" : "them"} to ${label(CLAUSE_OUTCOME_LABEL, undeterminedOutcomes[0])}.`
        : `${unchecked}; each used its policy's outcome for undetermined clauses.`;

  return (
    <article aria-labelledby="decision-title" className="space-y-6">
      <header className="space-y-2">
        <div className="flex min-w-0 items-center gap-1 text-13">
          <span className="truncate font-mono text-fg">
            {detail.application_id_external ?? shortId(detail.application_id)}
          </span>
          {detail.application_id_external ? (
            <CopyButton value={detail.application_id_external} label="external reference" />
          ) : null}
          {detail.application_id_external ? (
            <span className="ml-1 shrink-0 font-mono text-12 text-faint">{shortId(detail.application_id)}</span>
          ) : null}
          <CopyButton value={detail.application_id} label="application id" />
        </div>

        <h1 id="decision-title" className="flex items-center gap-2.5 text-20 font-semibold">
          <StatusGlyph status={detail.status} size={20} spin />
          {label(STATUS_LABEL, detail.status)}
        </h1>

        <p className="text-13 text-subtle">
          {customerName}
          {pinned ? <> · policy v{pinned}</> : null}
          <> · submitted {formatTs(detail.created_at)}</>
          {processing ? (
            <> · waiting {formatMs(Math.max(0, now - new Date(detail.created_at).getTime()))}</>
          ) : took ? (
            <> · {detail.status === "FAILED" ? "stopped after" : "decided in"} {took}</>
          ) : null}
        </p>

        {drifted ? (
          <p className="text-13 text-subtle">
            Pinned to v{pinned} when it was accepted. {customerName} is on{" "}
            <span className="text-fg">v{active}</span> now; this decision does not change.
          </p>
        ) : null}
      </header>

      {processing ? (
        <p className="text-13 text-subtle">
          The worker is verifying the business and reading the documents. This page updates on its
          own.
        </p>
      ) : null}

      {detail.status === "FAILED" ? (
        <Banner
          tone="reject"
          icon={<TriangleAlert className="h-3.5 w-3.5" strokeWidth={2} />}
          title="The worker could not finish this application"
        >
          <p>
            The worker stopped before a decision could be recorded, either because of an error or
            because it ran out of retries. No outcome was produced, and nothing below should be read
            as a policy result.
          </p>
        </Banner>
      ) : null}

      {detail.degraded ? (
        <Banner
          tone="review"
          icon={<TriangleAlert className="h-3.5 w-3.5" strokeWidth={2} />}
          title="Decided on incomplete evidence"
        >
          <p>{degradedText}</p>
          {(detail.degraded_reasons ?? []).length > 0 ? (
            <Collapsible summary={<span className="text-12">Show what was missing</span>}>
              <ul className="space-y-0.5 pb-1 text-12">
                {(detail.degraded_reasons ?? []).map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </Collapsible>
          ) : null}
        </Banner>
      ) : null}

      {injection ? (
        <Banner
          tone="reject"
          icon={<ShieldAlert className="h-3.5 w-3.5" strokeWidth={2} />}
          title="An instruction in the document was ignored"
        >
          {realQuote(injection.quote) ? (
            <p>
              <Quote>{realQuote(injection.quote)}</Quote>
            </p>
          ) : null}
          <p className="text-subtle">
            The model has no field that can set an outcome, so the text changed nothing. It is
            reported here for a reviewer.
          </p>
        </Banner>
      ) : null}

      {!processing && detail.status !== "FAILED" ? (
        <WhySummary status={detail.status} deciding={deciding} counts={counts} />
      ) : null}

      {!processing ? (
        <div>
          <div className="border-b">
            <Tabs
              idPrefix="decision"
              value={tab}
              onChange={(id) => onTab(id as TabId)}
              items={[
                { id: "clauses", label: "Clauses", count: reasons.length },
                {
                  id: "evidence",
                  label: "Evidence",
                  count: concerns.length || undefined,
                  tone: concerns.length ? "attention" : "default",
                },
                {
                  id: "calls",
                  label: "Registry calls",
                  shortLabel: "Calls",
                  count: calls.length,
                  tone: failedCalls ? "attention" : "default",
                },
                { id: "policy", label: "Policy" },
              ]}
            />
          </div>
          <div className="pt-5">
            <TabPanel idPrefix="decision" id="clauses" active={tab === "clauses"}>
              <ClausesPanel reasons={reasons} deciding={new Set(deciding.map((r) => r.clause_id))} />
            </TabPanel>
            <TabPanel idPrefix="decision" id="evidence" active={tab === "evidence"}>
              <EvidencePanel detail={detail} />
            </TabPanel>
            <TabPanel idPrefix="decision" id="calls" active={tab === "calls"}>
              <CallsPanel calls={calls} />
            </TabPanel>
            <TabPanel idPrefix="decision" id="policy" active={tab === "policy"}>
              <PolicyPanel detail={detail} customerName={customerName} />
            </TabPanel>
          </div>
        </div>
      ) : null}
    </article>
  );
}

function WhySummary({
  status,
  deciding,
  counts,
}: {
  status: string;
  deciding: Reason[];
  counts: Record<"FAIL" | "UNDETERMINED" | "PASS" | "NOT_APPLICABLE", number>;
}) {
  const failed = deciding.filter((r) => r.result === "FAIL");
  const undetermined = deciding.filter((r) => r.result === "UNDETERMINED");
  const tone = status === "REJECTED" ? "text-reject" : "text-review";
  const outcome = status === "REJECTED" ? "Reject" : "Review";

  return (
    <section aria-label="Why this outcome" className="space-y-2">
      {status === "APPROVED" ? <p className="text-14 text-fg">Every clause allows approval.</p> : null}
      {deciding.length > 0 ? (
        <ul className="space-y-1.5 text-14">
          {failed.map((r) => (
            <li key={r.clause_id} className="grid grid-cols-[16px_2.25rem_minmax(0,1fr)] gap-x-2.5">
              <span className="flex h-5 items-center">
                <ResultGlyph result={r.result} />
              </span>
              <span className="font-mono text-13 font-medium leading-5">{r.clause_id}</span>
              <span className="text-fg">
                {r.clause_text} <span className={cn("whitespace-nowrap text-13", tone)}>→ {outcome}</span>
              </span>
            </li>
          ))}
          {undetermined.length > 0 ? (
            <li className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2.5">
              <span className="flex h-5 items-center">
                <ResultGlyph result="UNDETERMINED" />
              </span>
              <span className="text-fg">
                <span className="font-mono text-13 font-medium">
                  {undetermined.map((r) => r.clause_id).join(", ")}
                </span>{" "}
                could not be checked{" "}
                <span className={cn("whitespace-nowrap text-13", tone)}>→ {outcome}</span>
              </span>
            </li>
          ) : null}
        </ul>
      ) : null}
      <p className="text-12 text-faint">
        {[
          counts.FAIL ? `${counts.FAIL} failed` : null,
          counts.UNDETERMINED ? `${counts.UNDETERMINED} undetermined` : null,
          counts.PASS ? `${counts.PASS} passed` : null,
          counts.NOT_APPLICABLE ? `${counts.NOT_APPLICABLE} not applicable` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </section>
  );
}
