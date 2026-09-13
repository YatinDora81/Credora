import {
  Check,
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleHelp,
  CircleX,
  Minus,
  TriangleAlert,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RESULT_LABEL, STATUS_LABEL, label } from "@/lib/labels";

type GlyphProps = { className?: string; size?: number };

const STATUS_GLYPH: Record<string, { Icon: typeof Check; color: string }> = {
  APPROVED: { Icon: CircleCheck, color: "text-approve" },
  REVIEW: { Icon: CircleDot, color: "text-review" },
  REJECTED: { Icon: CircleX, color: "text-reject" },
  FAILED: { Icon: TriangleAlert, color: "text-reject" },
  PROCESSING: { Icon: CircleDashed, color: "text-info" },
};

export function StatusGlyph({
  status,
  className,
  size = 14,
  spin = false,
}: GlyphProps & { status: string; spin?: boolean }) {
  const g = STATUS_GLYPH[status] ?? { Icon: CircleDashed, color: "text-faint" };
  return (
    <g.Icon
      aria-hidden
      width={size}
      height={size}
      strokeWidth={2}
      className={cn(
        "shrink-0",
        g.color,
        spin && status === "PROCESSING" && "motion-safe:animate-[spin_3s_linear_infinite]",
        className,
      )}
    />
  );
}

export function StatusLabel({ status, className, size }: GlyphProps & { status: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <StatusGlyph status={status} size={size} />
      <span>{label(STATUS_LABEL, status)}</span>
    </span>
  );
}

const RESULT_GLYPH: Record<string, { Icon: typeof Check; color: string }> = {
  PASS: { Icon: Check, color: "text-approve" },
  FAIL: { Icon: X, color: "text-reject" },
  UNDETERMINED: { Icon: CircleHelp, color: "text-review" },
  NOT_APPLICABLE: { Icon: Minus, color: "text-faint" },
};

export function ResultGlyph({ result, className, size = 14 }: GlyphProps & { result: string }) {
  const g = RESULT_GLYPH[result] ?? RESULT_GLYPH.NOT_APPLICABLE!;
  return (
    <g.Icon
      role="img"
      aria-label={label(RESULT_LABEL, result)}
      width={size}
      height={size}
      strokeWidth={2.25}
      className={cn("shrink-0", g.color, className)}
    />
  );
}

export type Tone = "approve" | "review" | "reject" | "info" | "faint";

export function Dot({ tone, className }: { tone: Tone; className?: string }) {
  const bg = {
    approve: "bg-approve",
    review: "bg-review",
    reject: "bg-reject",
    info: "bg-info",
    faint: "bg-faint",
  }[tone];
  return (
    <span aria-hidden className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", bg, className)} />
  );
}
