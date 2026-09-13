import { Dot, type Tone } from "@/components/ui/status";
import { CALL_OUTCOME_LABEL, label } from "@/lib/labels";
import { cn, formatMs, formatTime } from "@/lib/utils";
import type { UpstreamCallView } from "@/api";

const TONE: Record<string, Tone> = {
  SUCCESS: "approve",
  TIMEOUT: "review",
  RATE_LIMITED: "review",
  CIRCUIT_OPEN: "review",
  HTTP_5XX: "reject",
  HTTP_4XX: "reject",
  CONN_RESET: "reject",
};

export function CallsPanel({ calls }: { calls: UpstreamCallView[] }) {
  if (calls.length === 0) {
    return (
      <p className="text-13 text-subtle">
        No registry call was recorded. The worker either never reached this step or the application
        was replayed.
      </p>
    );
  }

  const sorted = [...calls].sort(
    (a, b) => Date.parse(a.started_at) - Date.parse(b.started_at) || a.attempt - b.attempt,
  );
  const first = Date.parse(sorted[0]!.started_at);
  const end = Math.max(...sorted.map((c) => Date.parse(c.started_at) + c.duration_ms));
  const span = end - first;
  const latest = sorted[sorted.length - 1]!;
  const succeeded = latest.outcome === "SUCCESS" ? latest : undefined;

  return (
    <div className="space-y-3">
      <p className="text-13 text-subtle">
        {sorted.length} attempt{sorted.length === 1 ? "" : "s"} over {formatMs(Math.max(0, span))} ·{" "}
        {succeeded ? (
          <span className="text-fg">succeeded on attempt {succeeded.attempt}</span>
        ) : (
          <span className="text-reject">no attempt succeeded</span>
        )}
      </p>
      <ol className="relative space-y-0">
        {sorted.map((c, i) => {
          const offset = Date.parse(c.started_at) - first;
          const tone = TONE[c.outcome] ?? "faint";
          const ok = c.outcome === "SUCCESS";
          return (
            <li key={`${c.attempt}-${i}`} className="grid grid-cols-[12px_minmax(0,1fr)_auto] gap-x-3">
              <span className="relative flex justify-center">
                <Dot tone={tone} className="mt-[7px] block" />
                {i < sorted.length - 1 ? (
                  <span aria-hidden className="absolute bottom-[-5px] top-[15px] w-px bg-line" />
                ) : null}
              </span>
              <div className="min-w-0 pb-4 text-13">
                <p>
                  <span className="text-fg">Attempt {c.attempt}</span>
                  <span className={cn("ml-2", ok ? "text-subtle" : tone === "reject" ? "text-reject" : "text-review")}>
                    {label(CALL_OUTCOME_LABEL, c.outcome)}
                    {c.status_code ? ` · ${c.status_code}` : ""}
                  </span>
                  {c.retry_after_sec != null ? (
                    <span className="ml-2 text-subtle">retry after {c.retry_after_sec} s</span>
                  ) : null}
                </p>
                {c.outcome === "CIRCUIT_OPEN" ? (
                  <p className="text-12 text-subtle">The breaker refused the call; no request was sent.</p>
                ) : null}
                {c.error ? (
                  <p className="line-clamp-2 break-all font-mono text-12 text-faint" title={c.error}>
                    {c.error}
                  </p>
                ) : null}
              </div>
              <span className="text-right text-12 tabular-nums text-faint">
                <span className="block">{formatMs(c.duration_ms)}</span>
                <span className="block" title={formatTime(c.started_at)}>
                  {i === 0 ? formatTime(c.started_at) : `+${formatMs(offset)}`}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
