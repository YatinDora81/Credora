import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, Moon, Sun } from "lucide-react";
import { Dot, type Tone } from "@/components/ui/status";
import { label, EXTRACTION_REASON_LABEL, humanize } from "@/lib/labels";
import { cn, formatMs } from "@/lib/utils";
import type { HealthResponse, KeepaliveResponse, ServiceLiveness } from "@/api";
import type { Route } from "@/App";

export type ServiceMap = Partial<KeepaliveResponse["services"]>;

const SERVICE_NAMES: { key: keyof KeepaliveResponse["services"]; name: string }[] = [
  { key: "api", name: "API" },
  { key: "worker", name: "Worker" },
  { key: "mock_upstream", name: "Mock registry" },
];

const SERVICE_STATUS_LABEL: Record<string, string> = {
  ok: "Healthy",
  starting: "Starting",
  degraded: "Degraded",
  stalled: "Stalled",
  stopping: "Stopping",
};

interface Issue {
  tone: Tone;
  text: string;
}

function serviceIssue(name: string, s: ServiceLiveness | undefined): Issue | null {
  if (!s) return null;
  if (!s.reachable) return { tone: "reject", text: `${name} unreachable` };
  if (s.status && s.status !== "ok") return { tone: "review", text: `${name} ${s.status}` };
  return null;
}

function collectIssues(
  services: ServiceMap | null,
  health: HealthResponse | null,
  healthError: string | null,
): Issue[] {
  const issues: Issue[] = [];
  if (services?.api && !services.api.reachable) {
    return [{ tone: "reject", text: "API unreachable" }];
  }
  for (const { key, name } of SERVICE_NAMES) {
    const issue = serviceIssue(name, services?.[key]);
    if (issue) issues.push(issue);
  }
  if (healthError && !health) issues.push({ tone: "reject", text: "Health check failing" });
  if (health) {
    if (health.service.db !== "ok") issues.push({ tone: "reject", text: "Database unreachable" });
    if (health.upstream.circuit === "OPEN") issues.push({ tone: "review", text: "Registry circuit open" });
    else if (health.upstream.circuit === "HALF_OPEN")
      issues.push({ tone: "review", text: "Registry circuit half-open" });
    if (health.model.outage_simulated) issues.push({ tone: "review", text: "Model outage switch on" });
    else if (!health.model.reachable) issues.push({ tone: "review", text: "Model unreachable" });
  }
  return issues.sort((a, b) => (a.tone === "reject" ? -1 : 0) - (b.tone === "reject" ? -1 : 0));
}

function Logo() {
  return (
    <svg aria-hidden viewBox="0 0 32 32" className="h-5 w-5 shrink-0">
      <rect width="32" height="32" rx="7.5" className="fill-fg" />
      <path
        d="M10 8.5h5.25a7.5 7.5 0 0 1 0 15H10z"
        fill="none"
        strokeWidth="3"
        strokeLinejoin="round"
        className="stroke-bg"
      />
      <circle cx="15.25" cy="16" r="2.25" className="fill-accent" />
    </svg>
  );
}

export function AppHeader({
  services,
  health,
  healthError,
  dark,
  onToggleTheme,
  route,
}: {
  services: ServiceMap | null;
  health: HealthResponse | null;
  healthError: string | null;
  dark: boolean;
  onToggleTheme: () => void;
  route: Route;
}) {
  const issues = collectIssues(services, health, healthError);
  const checking = !services && !health;
  const tone: Tone = checking ? "faint" : issues[0]?.tone ?? "approve";
  const summary = checking
    ? "Checking services…"
    : issues.length === 0
      ? "All systems normal"
      : issues.length === 1
        ? issues[0]!.text
        : `${issues[0]!.text} · ${issues.length - 1} more`;

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
      <div className="flex min-w-0 items-center gap-2">
        <Logo />
        <span className="text-14 font-semibold">Deepvue</span>
      </div>

      <nav aria-label="Pages" className="flex items-center gap-0.5 sm:ml-3">
        {(
          [
            { id: "console", href: "#/", label: "Console" },
            { id: "policies", href: "#/policies", label: "Policies" },
          ] as const
        ).map((item) => (
          <a
            key={item.id}
            href={item.href}
            aria-current={route === item.id ? "page" : undefined}
            className={cn(
              "flex h-8 items-center rounded px-2.5 text-13 font-medium text-subtle hover:bg-hover hover:text-fg",
              route === item.id && "bg-selected text-fg hover:bg-selected",
            )}
          >
            {item.label}
          </a>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-1">
        <Popover.Root>
          <Popover.Trigger asChild>
            <button
              type="button"
              className={cn(
                "flex h-8 max-w-[16rem] items-center gap-2 rounded px-2.5 text-13 hover:bg-hover",
                tone === "reject" ? "text-reject" : tone === "review" ? "text-fg" : "text-subtle",
              )}
            >
              <Dot tone={tone} />
              <span className="truncate">{summary}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-faint" strokeWidth={2} />
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              align="end"
              sideOffset={6}
              aria-label="System status"
              className="z-50 w-[20rem] max-w-[calc(100vw-24px)] rounded-md border border-line-strong/70 bg-surface p-1 text-13 shadow-float outline-none"
            >
              <SystemDetails services={services} health={health} healthError={healthError} />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>

        <button
          type="button"
          onClick={onToggleTheme}
          aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
          className="flex h-8 w-8 items-center justify-center rounded text-subtle hover:bg-hover hover:text-fg"
        >
          {dark ? <Sun className="h-4 w-4" strokeWidth={2} /> : <Moon className="h-4 w-4" strokeWidth={2} />}
        </button>
      </div>
    </header>
  );
}

function Row({ tone, name, value, detail }: { tone: Tone; name: string; value: string; detail?: string }) {
  return (
    <div className="grid grid-cols-[8px_7rem_minmax(0,1fr)] items-start gap-x-2 rounded px-2 py-1.5">
      <Dot tone={tone} className="mt-[7px]" />
      <span className="text-subtle">{name}</span>
      <span className="min-w-0">
        <span className="block truncate text-fg">{value}</span>
        {detail ? <span className="block truncate text-12 text-faint">{detail}</span> : null}
      </span>
    </div>
  );
}

function SystemDetails({
  services,
  health,
  healthError,
}: {
  services: ServiceMap | null;
  health: HealthResponse | null;
  healthError: string | null;
}) {
  const apiDown = !!services?.api && !services.api.reachable;
  return (
    <div>
      <p className="px-2 pb-1 pt-1.5 text-12 text-faint">Services</p>
      {SERVICE_NAMES.map(({ key, name }) => {
        const s = services?.[key];
        if (key !== "api" && apiDown) {
          return <Row key={key} tone="faint" name={name} value="Unknown" detail="API unreachable" />;
        }
        if (!s) return <Row key={key} tone="faint" name={name} value="Checking…" />;
        const tone: Tone = !s.reachable ? "reject" : s.status === "ok" ? "approve" : "review";
        const value = !s.reachable
          ? humanize(s.error) || "Unreachable"
          : `${SERVICE_STATUS_LABEL[s.status ?? ""] ?? (humanize(s.status) || "Unknown")}${s.latency_ms != null ? ` · ${s.latency_ms} ms` : ""}`;
        return <Row key={key} tone={tone} name={name} value={value} />;
      })}

      <div className="mx-1 my-1 h-px bg-line" />
      <p className="px-2 pb-1 pt-1.5 text-12 text-faint">Dependencies</p>
      {!health ? (
        <Row
          tone={healthError != null ? "reject" : "faint"}
          name="Health"
          value={healthError != null ? "Health check failing" : "Checking…"}
          detail={healthError != null ? humanize(healthError) || undefined : undefined}
        />
      ) : (
        <>
          <Row
            tone={health.service.db === "ok" ? "approve" : "reject"}
            name="Database"
            value={health.service.db === "ok" ? "Connected" : "Unreachable"}
          />
          <Row
            tone={health.upstream.circuit === "CLOSED" ? "approve" : health.upstream.circuit === "OPEN" ? "reject" : "review"}
            name="Registry circuit"
            value={humanize(health.upstream.circuit)}
            detail={
              health.upstream.consecutive_failures
                ? `${health.upstream.consecutive_failures} consecutive failure${health.upstream.consecutive_failures === 1 ? "" : "s"}`
                : undefined
            }
          />
          <Row
            tone={health.model.outage_simulated ? "review" : health.model.reachable ? "approve" : "reject"}
            name="Model"
            value={
              health.model.outage_simulated
                ? "Outage switch on"
                : health.model.reachable
                  ? "Reachable"
                  : label(EXTRACTION_REASON_LABEL, health.model.reason) || "Unreachable"
            }
            detail={health.model.model ?? undefined}
          />
          <Row
            tone={health.queue.pending > 0 ? "info" : "faint"}
            name="Queue"
            value={`${health.queue.pending} pending · ${health.queue.processing} processing`}
            detail={
              health.queue.oldest_pending_age_ms
                ? `Oldest waiting ${formatMs(health.queue.oldest_pending_age_ms)}`
                : undefined
            }
          />
        </>
      )}
    </div>
  );
}
