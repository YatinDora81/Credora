import { RefreshCw, Inbox } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status";
import { cn, formatTs, shortId } from "@/lib/utils";
import type { ApplicationListItem } from "@/api";

export interface ApplicationListProps {
  items: ApplicationListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  loading: boolean;
  polling: boolean;
  error: string | null;
}

export function ApplicationList({
  items,
  selectedId,
  onSelect,
  onRefresh,
  loading,
  polling,
  error,
}: ApplicationListProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="space-y-1">
          <CardTitle>2 · Recent applications</CardTitle>
          <CardDescription>
            {polling
              ? "Polling every 2s while anything is PROCESSING."
              : "Idle — nothing is processing, so polling is stopped."}
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {error ? (
          <p className="px-4 pb-4 text-sm text-red-600 dark:text-red-400">{error}</p>
        ) : null}
        {items.length === 0 && !error ? (
          <p className="flex items-center gap-2 px-4 pb-4 text-sm text-muted-foreground">
            <Inbox className="h-4 w-4" />
            No applications yet for this customer. Submit one above.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[7.5rem]">ID</TableHead>
                <TableHead>External ID</TableHead>
                <TableHead className="w-[9rem]">Status</TableHead>
                <TableHead className="w-[7rem]">Degraded</TableHead>
                <TableHead className="w-[6rem]">Policy</TableHead>
                <TableHead className="w-[12rem]">Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((a) => {
                const selected = a.application_id === selectedId;
                return (
                  <TableRow
                    key={a.application_id}
                    onClick={() => onSelect(a.application_id)}
                    tabIndex={0}
                    role="button"
                    aria-selected={selected}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(a.application_id);
                      }
                    }}
                    className={cn(
                      "cursor-pointer hover:bg-accent/60 focus:outline-none focus-visible:bg-accent",
                      selected && "bg-accent",
                    )}
                  >
                    <TableCell className="font-mono text-xs">
                      {shortId(a.application_id)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {a.application_id_external ?? "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={a.status} />
                    </TableCell>
                    <TableCell>
                      {a.degraded ? (
                        <Badge tone="amber">DEGRADED</Badge>
                      ) : a.status === "PROCESSING" ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <Badge tone="outline" className="opacity-60">
                          NO
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {a.policy?.version ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatTs(a.created_at)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
