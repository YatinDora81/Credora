import * as React from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { StatusGlyph } from "@/components/ui/status";
import { STATUS_LABEL, label } from "@/lib/labels";
import { cn, durationBetween, formatTs, relativeTime, shortId, useNow } from "@/lib/utils";
import type { ApplicationListItem } from "@/api";

export function ApplicationList({
  items,
  truncated,
  listLimit,
  customerName,
  selectedId,
  onSelect,
  onRefresh,
  initialLoading,
  refreshing,
  polling,
  error,
}: {
  items: ApplicationListItem[];
  truncated: boolean;
  listLimit: number;
  customerName: string;
  selectedId: string | null;
  onSelect: (id: string, reveal?: boolean) => void;
  onRefresh: () => void;
  initialLoading: boolean;
  refreshing: boolean;
  polling: boolean;
  error: string | null;
}) {
  const now = useNow(10_000);
  const refs = React.useRef(new Map<string, HTMLButtonElement>());

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    let next = -1;
    if (e.key === "ArrowDown") next = Math.min(items.length - 1, index + 1);
    else if (e.key === "ArrowUp") next = Math.max(0, index - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next < 0 || next === index) return;
    e.preventDefault();
    const id = items[next]!.application_id;
    onSelect(id, false);
    refs.current.get(id)?.focus();
  }

  const focusableId = selectedId && items.some((i) => i.application_id === selectedId)
    ? selectedId
    : items[0]?.application_id;

  return (
    <section aria-labelledby="list-title" className="flex min-h-0 flex-col lg:flex-1">
      <div className="flex h-11 shrink-0 items-center gap-2 border-y bg-bg px-4">
        <h2 id="list-title" className="text-14 font-semibold">
          Applications
        </h2>
        <span className="text-13 text-faint">
          {truncated ? `Latest ${listLimit} · ` : items.length > 0 ? `${items.length} · ` : ""}
          {customerName}
        </span>
        {polling ? (
          <span className="flex items-center gap-1.5 text-12 text-info">
            <StatusGlyph status="PROCESSING" size={12} spin />
            Live
          </span>
        ) : null}
        <button
          type="button"
          onClick={onRefresh}
          aria-label="Refresh applications"
          className="ml-auto flex h-7 w-7 items-center justify-center rounded text-faint hover:bg-hover hover:text-fg"
        >
          <RefreshCw
            className={cn("h-3.5 w-3.5", refreshing && "motion-safe:animate-spin")}
            strokeWidth={2}
          />
        </button>
      </div>

      {error ? (
        <p className="border-b px-4 py-2 text-13 text-reject">
          Could not load applications: {error}
        </p>
      ) : null}

      {initialLoading ? (
        <ul aria-hidden className="divide-y divide-line">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex h-14 items-center gap-3 px-4">
              <span className="h-3.5 w-3.5 rounded-full bg-selected" />
              <span className="h-3 w-40 rounded bg-selected" />
              <span className="ml-auto h-3 w-10 rounded bg-hover" />
            </li>
          ))}
        </ul>
      ) : items.length === 0 && !error ? (
        <div className="px-4 py-5 text-13">
          <p className="text-fg">No applications for {customerName} yet.</p>
          <p className="mt-1 text-subtle">
            Pick a scenario above and submit it. A.1 is the baseline; the A.2 cases are adversarial.
          </p>
        </div>
      ) : (
        <div
          role="listbox"
          aria-label={`Applications for ${customerName}`}
          className="scrollbar-thin max-h-[23rem] divide-y divide-line overflow-y-auto lg:max-h-none lg:min-h-0 lg:flex-1"
        >
          {items.map((a, index) => {
            const selected = a.application_id === selectedId;
            const took = durationBetween(a.created_at, a.decided_at);
            return (
              <button
                key={a.application_id}
                ref={(el) => {
                  if (el) refs.current.set(a.application_id, el);
                  else refs.current.delete(a.application_id);
                }}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={a.application_id === focusableId ? 0 : -1}
                onClick={() => onSelect(a.application_id)}
                onKeyDown={(e) => onKeyDown(e, index)}
                className={cn(
                  "group grid w-full grid-cols-[14px_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2.5 text-left hover:bg-hover focus-visible:-outline-offset-2",
                  selected && "bg-selected shadow-[inset_2px_0_0_0_oklch(var(--accent))] hover:bg-selected",
                )}
              >
                <StatusGlyph status={a.status} spin />
                <span className="min-w-0" title={a.application_id}>
                  <span className="block truncate font-mono text-13 text-fg">
                    {a.application_id_external ?? shortId(a.application_id)}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-12 text-subtle">
                    <span>{label(STATUS_LABEL, a.status)}</span>
                    {a.application_id_external ? (
                      <>
                        <span aria-hidden className="text-faint group-aria-selected:text-subtle">·</span>
                        <span className="font-mono text-faint group-aria-selected:text-subtle">{shortId(a.application_id)}</span>
                      </>
                    ) : null}
                    {a.policy?.version ? (
                      <>
                        <span aria-hidden className="text-faint group-aria-selected:text-subtle">·</span>
                        <span className="text-faint group-aria-selected:text-subtle">v{a.policy.version}</span>
                      </>
                    ) : null}
                    {a.degraded ? (
                      <>
                        <span aria-hidden className="text-faint group-aria-selected:text-subtle">·</span>
                        <span className="inline-flex items-center gap-1 text-review">
                          <TriangleAlert className="h-3 w-3" strokeWidth={2} aria-hidden />
                          Degraded
                        </span>
                      </>
                    ) : null}
                  </span>
                </span>
                <span
                  className="text-right text-12 tabular-nums text-faint group-aria-selected:text-subtle"
                  title={formatTs(a.created_at)}
                >
                  <span className="block">{relativeTime(a.created_at, now)}</span>
                  {took ? <span className="block">{took}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
