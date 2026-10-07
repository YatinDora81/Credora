import * as React from "react";
import { AppHeader, type ServiceMap } from "@/components/AppHeader";
import { ApplicationList } from "@/components/ApplicationList";
import { Composer, type SubmitResult } from "@/components/Composer";
import { DecisionView } from "@/components/DecisionView";
import { PoliciesPage } from "@/components/PoliciesPage";
import {
  ApiError,
  getHealth,
  keepalive,
  listApplications,
  pingServices,
  type ApplicationListItem,
  type HealthResponse,
} from "@/api";
import { CUSTOMERS, customerByKey } from "@/fixtures";
import { cn } from "@/lib/utils";

const LIST_LIMIT = 25;
const LIST_POLL_MS = 2000;
const HEALTH_POLL_MS = 5000;
const KEEPALIVE_MS = 2000;
const THEME_KEY = "credora.theme";

export type Route = "console" | "policies";

function readRoute(): Route {
  return window.location.hash.replace(/^#\/?/, "").split(/[?/]/)[0] === "policies" ? "policies" : "console";
}

function useRoute(): Route {
  const [route, setRoute] = React.useState<Route>(readRoute);
  React.useEffect(() => {
    const onChange = () => setRoute(readRoute());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  React.useEffect(() => {
    document.title = route === "policies" ? "Policies · Credora" : "Credora · Decisioning console";
  }, [route]);
  return route;
}

function readTheme(): boolean {
  return document.documentElement.classList.contains("dark");
}

export default function App() {
  const route = useRoute();
  const [apiKey, setApiKey] = React.useState<string>(CUSTOMERS[0]!.apiKey);
  const [items, setItems] = React.useState<ApplicationListItem[]>([]);
  const [optimistic, setOptimistic] = React.useState<ApplicationListItem[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [listError, setListError] = React.useState<string | null>(null);
  const [initialLoading, setInitialLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [health, setHealth] = React.useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = React.useState<string | null>(null);
  const [services, setServices] = React.useState<ServiceMap | null>(null);
  const [dark, setDark] = React.useState(readTheme);
  const decisionRef = React.useRef<HTMLElement>(null);
  const listAbort = React.useRef<AbortController | null>(null);
  const apiKeyRef = React.useRef(apiKey);
  apiKeyRef.current = apiKey;

  const customer = customerByKey(apiKey);

  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  const toggleTheme = React.useCallback(() => {
    setDark((d) => {
      const next = !d;
      try {
        localStorage.setItem(THEME_KEY, next ? "dark" : "light");
      } catch {
        return next;
      }
      return next;
    });
  }, []);

  const refresh = React.useCallback(
    async (manual = false) => {
      listAbort.current?.abort();
      const controller = new AbortController();
      listAbort.current = controller;
      if (manual) setRefreshing(true);
      try {
        const rows = await listApplications(apiKey, LIST_LIMIT, controller.signal);
        if (controller.signal.aborted || apiKey !== apiKeyRef.current) return;
        setItems(rows);
        setListError(null);
        setOptimistic((prev) =>
          prev.filter((o) => !rows.some((r) => r.application_id === o.application_id)),
        );
      } catch (e) {
        if (controller.signal.aborted || apiKey !== apiKeyRef.current) return;
        setListError(e instanceof ApiError ? (e.body?.error ?? `HTTP ${e.status}`) : String(e));
      } finally {
        if (listAbort.current === controller) {
          listAbort.current = null;
          setInitialLoading(false);
          setRefreshing(false);
        }
      }
    },
    [apiKey],
  );

  React.useEffect(() => {
    setItems([]);
    setOptimistic([]);
    setSelectedId(null);
    setListError(null);
    setInitialLoading(true);
    setRefreshing(false);
    void refresh();
    return () => listAbort.current?.abort();
  }, [refresh]);

  const merged = React.useMemo(
    () => [
      ...optimistic.filter((o) => !items.some((i) => i.application_id === o.application_id)),
      ...items,
    ],
    [optimistic, items],
  );
  const anyProcessing = merged.some((a) => a.status === "PROCESSING");

  React.useEffect(() => {
    if (!anyProcessing) return;
    const t = setInterval(() => {
      if (!listAbort.current) void refresh();
    }, LIST_POLL_MS);
    return () => clearInterval(t);
  }, [anyProcessing, refresh]);

  const select = React.useCallback((id: string, reveal = true) => {
    setSelectedId(id);
    if (reveal && window.matchMedia("(max-width: 1023px)").matches) {
      requestAnimationFrame(() => decisionRef.current?.scrollIntoView({ block: "start" }));
    }
  }, []);

  const handleSubmitted = React.useCallback(
    ({ applicationId, replayed, apiKey: submittedWith }: SubmitResult) => {
      if (submittedWith !== apiKeyRef.current) return;
      if (!replayed) {
        setOptimistic((prev) =>
          prev.some((p) => p.application_id === applicationId)
            ? prev
            : [
                {
                  application_id: applicationId,
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
      }
      select(applicationId);
      void refresh();
    },
    [refresh, select],
  );

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
        if (!cancelled) {
          setHealthError(
            e instanceof ApiError
              ? (e.body?.error ?? (e.status ? `http_${e.status}` : "network_error"))
              : String(e),
          );
        }
      }
    }
    void tick();
    const t = setInterval(tick, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function ping() {
      const direct = pingServices();
      try {
        const k = await keepalive();
        if (!cancelled) setServices(k.services);
      } catch (e) {
        if (!cancelled) {
          const error =
            e instanceof ApiError
              ? (e.body?.error ?? (e.status ? `http_${e.status}` : "network_error"))
              : String(e);
          setServices((prev) => ({
            ...prev,
            api: { reachable: false, status: null, latency_ms: null, error },
          }));
        }
      }
      await direct;
      if (!cancelled) timer = setTimeout(ping, KEEPALIVE_MS);
    }
    void ping();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className="flex min-h-full flex-col lg:h-full">
      <AppHeader
        services={services}
        health={health}
        healthError={healthError}
        dark={dark}
        onToggleTheme={toggleTheme}
        route={route}
      />
      {route === "policies" ? (
        <div className="flex-1 lg:min-h-0">
          <PoliciesPage />
        </div>
      ) : null}
      <div
        className={cn(
          "flex-1 lg:grid lg:min-h-0 lg:grid-cols-[400px_minmax(0,1fr)] xl:grid-cols-[440px_minmax(0,1fr)]",
          route !== "console" && "!hidden",
        )}
      >
        <aside className="border-b lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden lg:border-b-0 lg:border-r">
          <div className="scrollbar-thin lg:max-h-[58%] lg:shrink-0 lg:overflow-y-auto">
            <Composer apiKey={apiKey} onApiKeyChange={setApiKey} onSubmitted={handleSubmitted} />
          </div>
          <ApplicationList
            items={merged}
            truncated={items.length >= LIST_LIMIT}
            listLimit={LIST_LIMIT}
            customerName={customer.name}
            selectedId={selectedId}
            onSelect={select}
            onRefresh={() => void refresh(true)}
            initialLoading={initialLoading}
            refreshing={refreshing}
            polling={anyProcessing}
            error={listError}
          />
        </aside>
        <main
          ref={decisionRef}
          aria-label="Decision"
          className={cn("scrollbar-thin lg:min-h-0 lg:overflow-y-auto", selectedId && "min-h-[100dvh]")}
        >
          <DecisionView apiKey={apiKey} applicationId={selectedId} onTerminal={() => void refresh()} />
        </main>
      </div>
    </div>
  );
}
