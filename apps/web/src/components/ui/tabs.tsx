import * as React from "react";
import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TabItem {
  id: string;
  label: string;
  shortLabel?: string;
  count?: number;
  tone?: "default" | "attention";
}

export function Tabs({
  items,
  value,
  onChange,
  idPrefix,
  className,
}: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  idPrefix: string;
  className?: string;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    let next = -1;
    if (e.key === "ArrowRight") next = (index + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(items[next]!.id);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="tablist"
      className={cn("flex items-center gap-0.5 overflow-x-auto scrollbar-none sm:gap-1", className)}
    >
      {items.map((t, i) => {
        const selected = t.id === value;
        const attention = t.tone === "attention";
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            id={`${idPrefix}-tab-${t.id}`}
            aria-selected={selected}
            aria-controls={selected ? `${idPrefix}-panel-${t.id}` : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "relative flex h-9 shrink-0 items-center gap-1.5 rounded px-2 text-13 font-medium text-subtle transition-colors hover:text-fg focus-visible:-outline-offset-2 sm:px-2.5",
              selected &&
                "text-fg after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-fg sm:after:inset-x-2.5",
            )}
          >
            {t.shortLabel ? (
              <>
                <span className="sm:hidden">{t.shortLabel}</span>
                <span className="hidden sm:inline">{t.label}</span>
              </>
            ) : (
              t.label
            )}
            {t.count !== undefined ? (
              <span className={cn("inline-flex items-center gap-1 tabular-nums text-12 text-faint", attention && "text-review")}>
                {attention ? <TriangleAlert className="h-3 w-3" strokeWidth={2} aria-hidden /> : null}
                {t.count}
                {attention ? <span className="sr-only">, needs attention</span> : null}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  idPrefix,
  id,
  active,
  children,
  className,
}: {
  idPrefix: string;
  id: string;
  active: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  if (!active) return null;
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${id}`}
      aria-labelledby={`${idPrefix}-tab-${id}`}
      tabIndex={0}
      className={cn("rounded", className)}
    >
      {children}
    </div>
  );
}
