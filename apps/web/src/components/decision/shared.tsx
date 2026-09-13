import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Reason } from "@/api";

export function Banner({
  tone,
  icon,
  title,
  children,
}: {
  tone: "review" | "reject" | "info";
  icon: React.ReactNode;
  title: React.ReactNode;
  children?: React.ReactNode;
}) {
  const styles = {
    review: "border-review/30 bg-review-tint",
    reject: "border-reject/30 bg-reject-tint",
    info: "border-info/25 bg-info-tint",
  }[tone];
  const titleColor = { review: "text-review", reject: "text-reject", info: "text-info" }[tone];
  return (
    <div className={cn("rounded border px-3.5 py-3 text-13", styles)}>
      <p className={cn("flex items-start gap-2 font-medium", titleColor)}>
        <span className="mt-[3px] shrink-0">{icon}</span>
        <span>{title}</span>
      </p>
      {children ? <div className="mt-1.5 space-y-1 pl-[22px] text-fg/85">{children}</div> : null}
    </div>
  );
}

export const PLACEHOLDER_QUOTE = "(flagged by the extractor)";

export function realQuote(quote: string | null | undefined): string | null {
  const t = (quote ?? "").trim();
  return t && t !== PLACEHOLDER_QUOTE ? t : null;
}

export function Quote({ children, className }: { children: React.ReactNode; className?: string }) {
  return <q className={cn("italic", className)}>{children}</q>;
}

export function Collapsible({
  summary,
  defaultOpen = false,
  children,
}: {
  summary: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  const id = React.useId();
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex h-8 items-center gap-1.5 rounded pr-2 text-13 text-subtle hover:text-fg"
      >
        <ChevronRight className={cn("h-3.5 w-3.5 text-faint", open && "rotate-90")} strokeWidth={2} />
        {summary}
      </button>
      {open ? <div id={id}>{children}</div> : null}
    </div>
  );
}

export function SectionHeading({ children, meta }: { children: React.ReactNode; meta?: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <h3 className="text-13 font-semibold text-fg">{children}</h3>
      {meta ? <span className="text-12 text-faint">{meta}</span> : null}
    </div>
  );
}

const SEVERITY: Record<string, number> = { FAIL: 0, UNDETERMINED: 1, PASS: 2, NOT_APPLICABLE: 3 };

export function sortBySeverity(reasons: Reason[]): Reason[] {
  return [...reasons].sort(
    (a, b) => (SEVERITY[a.result] ?? 9) - (SEVERITY[b.result] ?? 9),
  );
}

export function decidingClauses(status: string, reasons: Reason[]): Reason[] {
  if (status === "REJECTED") return reasons.filter((r) => r.outcome === "REJECT");
  if (status === "REVIEW") return reasons.filter((r) => r.outcome === "REVIEW");
  return [];
}
