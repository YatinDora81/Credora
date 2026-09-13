import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide transition-colors",
  {
    variants: {
      tone: {
        neutral:
          "border-border bg-muted text-muted-foreground",
        green:
          "border-emerald-600/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
        amber:
          "border-amber-600/40 bg-amber-500/15 text-amber-700 dark:text-amber-300",
        red: "border-red-600/45 bg-red-500/15 text-red-700 dark:text-red-300",
        blue: "border-sky-600/40 bg-sky-500/15 text-sky-700 dark:text-sky-300",
        grey: "border-zinc-500/40 bg-zinc-500/15 text-zinc-600 dark:text-zinc-300",
        violet:
          "border-violet-600/40 bg-violet-500/15 text-violet-700 dark:text-violet-300",
        outline: "border-border bg-transparent text-foreground",
      },
      size: {
        default: "text-xs",
        xl: "px-4 py-1.5 text-base",
      },
    },
    defaultVariants: { tone: "neutral", size: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, size }), className)} {...props} />;
}
