import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("h-3 w-3 motion-safe:animate-spin", className)} aria-hidden />;
}
