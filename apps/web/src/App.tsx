import * as React from "react";
import { Activity, Cpu, Moon, Sun, Database, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CircuitBadge } from "@/components/ui/status";
import { ApplicationList } from "@/components/ApplicationList";
import { DecisionView } from "@/components/DecisionView";
import { CUSTOMERS, SubmitPanel } from "@/components/SubmitPanel";
import {
  ApiError,
  getHealth,
  listApplications,
  type ApplicationListItem,
  type HealthResponse,
} from "@/api";

const LIST_POLL_MS = 2000;
const HEALTH_POLL_MS = 5000;

export default function App() {
  const [apiKey, setApiKey] = React.useState<string>(CUSTOMERS[0].apiKey);
  const [items, setItems] = React.useState<ApplicationListItem[]>([]);
  const [optimistic, setOptimistic] = React.useState<ApplicationListItem[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [listError, setListError] = React.useState<string | null>(null);
  const [listLoading, setListLoading] = React.useState(false);
  const [health, setHealth] = React.useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = React.useState<string | null>(null);
  const [dark, setDark] = React.useState(true);

  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const refresh = React.useCallback(async () => {
    setListLoading(true);
    try {
      const rows = await listApplications(apiKey, 25);
      setItems(rows);
      setListError(null);
      setOptimistic((prev) =>
        prev.filter((o) => !rows.some((r) => r.application_id === o.application_id)),
      );
    } catch (e) {
      setListError(e instanceof ApiError ? `${e.status} ${e.message}` : String(e));
    } finally {
      setListLoading(false);
    }
  }, [apiKey]);

  React.useEffect(() => {
    setItems([]);
    setOptimistic([]);
    setSelectedId(null);
    void refresh();
  }, [refresh]);

  const merged = React.useMemo(() => [...optimistic, ...items], [optimistic, items]);
  const anyProcessing = merged.some((a) => a.status === "PROCESSING");

  React.useEffect(() => {
    if (!anyProcessing) return;
    const t = setInterval(() => void refresh(), LIST_POLL_MS);
    return () => clearInterval(t);
  }, [anyProcessing, refresh]);

  const handleSubmitted = React.useCallback((id: string) => {
    setOptimistic((prev) =>
      prev.some((p) => p.application_id === id)
        ? prev
        : [
            {
              application_id: id,
              application_id_external: null,
              status: "PROCESSING",
              degraded: null,
              policy: null,
              created_at: new Date().toISOString(),
              decided_at: null,
            },
            ...prev,
          ],
    );
    setSelectedId(id);
    void refresh();
  }, [refresh]);

  React.useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const h = await getHealth();
        if (!cancelled) {
          setHealth(h);
          setHealthError(null);
        }
      } catch (e) {
        if (!cancelled) setHealthError(e instanceof ApiError ? e.message : String(e));
      }
    }
    void tick();
    const t = setInterval(tick, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <HealthStrip
        health={health}
        error={healthError}
        dark={dark}
        onToggleTheme={() => setDark((d) => !d)}
      />
      <main className="mx-auto w-full max-w-[1400px] space-y-6 px-4 py-6 md:px-6">
        <SubmitPanel
          apiKey={apiKey}
          onApiKeyChange={setApiKey}
          onSubmitted={handleSubmitted}
        />
        <ApplicationList
          items={merged}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onRefresh={() => void refresh()}
          loading={listLoading}
          polling={anyProcessing}
          error={listError}
        />
        <DecisionView
          apiKey={apiKey}
          applicationId={selectedId}
          onTerminal={() => void refresh()}
        />
        <footer className="pb-8 pt-2 text-center text-xs text-muted-foreground">
          The model never decides anything. Every outcome on this page came from the pinned
          policy evaluated over resolved evidence.
        </footer>
      </main>
    </div>
  );
}

function HealthStrip({
  health,
  error,
  dark,
  onToggleTheme,
}: {
  health: HealthResponse | null;
  error: string | null;
  dark: boolean;
  onToggleTheme: () => void;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5 md:px-6">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4" />
          <span className="text-sm font-semibold">Deepvue · Risk Decisioning</span>
        </div>

        {error ? (
          <Badge tone="red">HEALTH UNREACHABLE</Badge>
        ) : !health ? (
          <Badge tone="neutral">HEALTH …</Badge>
        ) : (
          <>
            <Badge tone={health.status === "ok" ? "green" : "amber"}>{health.status}</Badge>

            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Activity className="h-3.5 w-3.5" />
              upstream
              <CircuitBadge circuit={health.upstream.circuit} />
              <span className="font-mono">
                {health.upstream.consecutive_failures} consecutive failure
                {health.upstream.consecutive_failures === 1 ? "" : "s"}
              </span>
            </span>

            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Cpu className="h-3.5 w-3.5" />
              model
              {health.model.outage_simulated ? (
                <Badge tone="violet">OUTAGE SIMULATED</Badge>
              ) : health.model.reachable ? (
                <Badge tone="green">REACHABLE</Badge>
              ) : (
                <Badge tone="red">UNREACHABLE</Badge>
              )}
              {health.model.model ? (
                <span className="font-mono">{health.model.model}</span>
              ) : null}
            </span>

            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Database className="h-3.5 w-3.5" />
              queue
              <span className="font-mono">
                {health.queue.pending} pending · {health.queue.processing} processing
              </span>
            </span>
          </>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="ml-auto"
          aria-label="Toggle theme"
          onClick={onToggleTheme}
        >
          {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </div>
    </header>
  );
}
