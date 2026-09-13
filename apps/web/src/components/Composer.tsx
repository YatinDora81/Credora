import * as React from "react";
import { Braces, ChevronRight, KeyRound, Repeat2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { StatusGlyph } from "@/components/ui/status";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError, createApplication } from "@/api";
import {
  CUSTOMERS,
  SCENARIOS,
  customerByKey,
  expectedFor,
  fixtureJson,
  scenarioByKey,
  type Customer,
  type SampleKey,
  type Scenario,
  type ScenarioGroup,
} from "@/fixtures";
import { STATUS_LABEL } from "@/lib/labels";
import { cn, shortId } from "@/lib/utils";

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const GROUPS: ScenarioGroup[] = ["Baseline", "Clean approval", "Adversarial", "Edge case"];

const SUBMIT_HINT =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘↵" : "Ctrl ↵";

export interface SubmitResult {
  applicationId: string;
  replayed: boolean;
  apiKey: string;
}

export function Composer({
  apiKey,
  onApiKeyChange,
  onSubmitted,
}: {
  apiKey: string;
  onApiKeyChange: (key: string) => void;
  onSubmitted: (result: SubmitResult) => void;
}) {
  const customer = customerByKey(apiKey);
  const [scenarioKey, setScenarioKey] = React.useState<SampleKey>("A.1");
  const [json, setJson] = React.useState(() => fixtureJson("A.1"));
  const [edited, setEdited] = React.useState(false);
  const [bodyOpen, setBodyOpen] = React.useState(false);
  const [keyOpen, setKeyOpen] = React.useState(false);
  const [idemKey, setIdemKey] = React.useState(() => uuid());
  const [lastUsedKey, setLastUsedKey] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<ApiError | null>(null);
  const [notice, setNotice] = React.useState<SubmitResult | null>(null);

  const scenario = scenarioByKey(scenarioKey)!;
  const bodyErrorId = React.useId();

  const parsed = React.useMemo(() => {
    try {
      return { value: JSON.parse(json) as unknown, error: null as string | null };
    } catch (e) {
      return { value: null, error: (e as Error).message };
    }
  }, [json]);

  function loadScenario(key: SampleKey) {
    setScenarioKey(key);
    setJson(fixtureJson(key));
    setEdited(false);
    setError(null);
    setNotice(null);
  }

  async function submit() {
    if (parsed.error || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const keyUsed = idemKey.trim();
    try {
      const res = await createApplication({
        apiKey,
        idempotencyKey: keyUsed || undefined,
        payload: parsed.value,
      });
      setLastUsedKey(keyUsed || null);
      setIdemKey(uuid());
      const result = { applicationId: res.application_id, replayed: res.replayed, apiKey };
      setNotice(result);
      onSubmitted(result);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, null, String(e)));
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter" || !(e.metaKey || e.ctrlKey)) return;
    if ((e.target as HTMLElement).closest('[role="combobox"],[role="listbox"],[role="option"]')) return;
    e.preventDefault();
    if (e.repeat) return;
    void submit();
  }

  return (
    <section aria-labelledby="composer-title" className="space-y-4 px-4 pb-5 pt-4" onKeyDown={onKeyDown}>
      <h2 id="composer-title" className="text-14 font-semibold">
        New application
      </h2>

      <Field label="Customer" htmlFor="customer">
        <Select
          value={apiKey}
          disabled={busy}
          onValueChange={(v) => {
            setNotice(null);
            setError(null);
            onApiKeyChange(v);
          }}
        >
          <SelectTrigger id="customer">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CUSTOMERS.map((c) => (
              <SelectItem
                key={c.apiKey}
                value={c.apiKey}
                description={c.posture}
                accessory={
                  <span className="font-mono text-12 text-faint">
                    {c.versions.map((v) => `v${v}`).join(" · ")}
                  </span>
                }
              >
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field label="Scenario" htmlFor="scenario">
        <Select value={scenarioKey} onValueChange={(v) => loadScenario(v as SampleKey)}>
          <SelectTrigger id="scenario">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-[min(32rem,var(--radix-select-content-available-height))] w-[max(var(--radix-select-trigger-width),27rem)]">
            {GROUPS.map((group, gi) => (
              <React.Fragment key={group}>
                {gi > 0 ? <SelectSeparator /> : null}
                <SelectGroup>
                  <SelectLabel>{group}</SelectLabel>
                  {SCENARIOS.filter((s) => s.group === group).map((s) => (
                    <ScenarioOption key={s.key} scenario={s} customer={customer} />
                  ))}
                </SelectGroup>
              </React.Fragment>
            ))}
          </SelectContent>
        </Select>
        <ScenarioBrief scenario={scenario} customer={customer} edited={edited} />
      </Field>

      <div className="divide-y divide-line rounded border">
        <Disclosure
          open={bodyOpen}
          onToggle={setBodyOpen}
          title="Request body"
          meta={
            parsed.error ? (
              <span className="text-reject">Invalid JSON</span>
            ) : edited ? (
              <span className="text-review">Edited</span>
            ) : (
              <span>{scenario.key} as loaded</span>
            )
          }
        >
          <textarea
            aria-label="Request body JSON"
            aria-invalid={parsed.error ? true : undefined}
            aria-describedby={parsed.error ? bodyErrorId : undefined}
            spellCheck={false}
            value={json}
            onChange={(e) => {
              setJson(e.target.value);
              setEdited(true);
            }}
            className={cn(
              "block h-72 w-full resize-y overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words rounded border bg-bg px-3 py-2 font-mono text-12 leading-5 text-fg scrollbar-thin focus:outline-none focus-visible:outline-2 focus-visible:outline-accent",
              parsed.error && "border-reject/60",
            )}
          />
          {parsed.error ? (
            <p id={bodyErrorId} className="mt-1.5 text-12 text-reject">
              {parsed.error}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button
              size="xs"
              variant="ghost"
              disabled={!!parsed.error}
              onClick={() => setJson(JSON.stringify(parsed.value, null, 2))}
            >
              <Braces className="h-3.5 w-3.5" strokeWidth={2} />
              Format
            </Button>
            <Button size="xs" variant="ghost" disabled={!edited} onClick={() => loadScenario(scenarioKey)}>
              <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
              Reset to {scenario.key}
            </Button>
          </div>
        </Disclosure>

        <Disclosure
          open={keyOpen}
          onToggle={setKeyOpen}
          title="Idempotency key"
          meta={<span className="font-mono">{idemKey ? `${idemKey.slice(0, 8)}…` : "none"}</span>}
        >
          <p className="mb-2 text-12 text-subtle">
            Sending the same key with the same body returns the original application. The same key
            with a different body is refused with 409.
          </p>
          <input
            aria-label="Idempotency key"
            value={idemKey}
            spellCheck={false}
            onChange={(e) => setIdemKey(e.target.value)}
            className="h-8 w-full rounded border border-line-strong bg-bg px-2.5 font-mono text-12 text-fg focus:outline-none focus-visible:outline-2 focus-visible:outline-accent"
          />
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Button
              size="xs"
              variant="ghost"
              disabled={!lastUsedKey}
              onClick={() => lastUsedKey && setIdemKey(lastUsedKey)}
            >
              <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
              Reuse last key
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setIdemKey(uuid())}>
              <KeyRound className="h-3.5 w-3.5" strokeWidth={2} />
              New key
            </Button>
            {lastUsedKey ? (
              <span className="ml-auto truncate font-mono text-12 text-faint" title={lastUsedKey}>
                last {lastUsedKey.slice(0, 8)}…
              </span>
            ) : null}
          </div>
        </Disclosure>
      </div>

      <div className="space-y-2">
        <Button
          variant="primary"
          size="md"
          className="w-full"
          onClick={() => void submit()}
          disabled={busy || !!parsed.error}
        >
          {busy ? <Spinner className="h-3.5 w-3.5" /> : null}
          {busy ? "Submitting…" : "Submit application"}
          {!busy ? (
            <kbd className="ml-1 hidden font-sans text-12 font-normal text-bg/60 sm:inline">{SUBMIT_HINT}</kbd>
          ) : null}
        </Button>

        <div aria-live="polite">
          {notice ? <SubmitNotice notice={notice} /> : null}
          {error ? <SubmitError error={error} /> : null}
        </div>
      </div>
    </section>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-13 font-medium text-subtle">
        {label}
      </label>
      {children}
    </div>
  );
}

function ExpectedChips({ scenario, customer }: { scenario: Scenario; customer: Customer }) {
  const expected = expectedFor(scenario, customer);
  const multi = expected.length > 1;
  const spoken = expected.map((e) => `${STATUS_LABEL[e.decision]} on ${e.version}`).join(", ");
  return (
    <span
      aria-label={`Expected: ${spoken}`}
      className={cn(
        "flex flex-wrap gap-x-3 gap-y-0.5 whitespace-nowrap text-12 text-subtle sm:grid sm:items-center sm:gap-x-1.5",
        multi ? "sm:grid-cols-[13px_auto_auto]" : "sm:grid-cols-[13px_auto]",
      )}
    >
      {expected.map((e) => (
        <span key={e.version} className="inline-flex items-center gap-1.5 sm:contents">
          <StatusGlyph status={e.decision} size={13} />
          <span>{STATUS_LABEL[e.decision]}</span>
          {multi ? <span className="font-mono text-faint">v{e.version}</span> : null}
        </span>
      ))}
    </span>
  );
}

function ScenarioOption({ scenario, customer }: { scenario: Scenario; customer: Customer }) {
  const id = React.useId();
  return (
    <SelectItem
      value={scenario.key}
      textValue={`${scenario.key} ${scenario.title}`}
      textId={`${id}-t`}
      descriptionId={`${id}-d`}
      aria-labelledby={`${id}-t ${id}-o`}
      aria-describedby={`${id}-d`}
      accessory={
        <span id={`${id}-o`}>
          <ExpectedChips scenario={scenario} customer={customer} />
        </span>
      }
      description={scenario.description}
    >
      <span className="mr-1 font-mono text-12 font-normal text-faint">{scenario.key}</span>{" "}
      {scenario.title}
    </SelectItem>
  );
}

function ScenarioBrief({
  scenario,
  customer,
  edited,
}: {
  scenario: Scenario;
  customer: Customer;
  edited: boolean;
}) {
  const expected = expectedFor(scenario, customer);
  return (
    <div className="space-y-2.5 pt-1">
      <p className="text-13 text-subtle">{scenario.description}</p>
      <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-13">
        <dt className="text-faint">Expected</dt>
        <dd className="flex flex-wrap gap-x-3 gap-y-1">
          {expected.map((e) => (
            <span key={e.version} className="inline-flex items-center gap-1.5">
              <StatusGlyph status={e.decision} size={13} />
              <span className="text-fg">{STATUS_LABEL[e.decision]}</span>
              <span className="font-mono text-12 text-faint">v{e.version}</span>
            </span>
          ))}
          {edited ? <span className="text-12 text-review">Payload edited, may differ</span> : null}
        </dd>
        <dt className="text-faint">Look for</dt>
        <dd className="text-fg">{scenario.lookFor}</dd>
      </dl>
    </div>
  );
}

function Disclosure({
  open,
  onToggle,
  title,
  meta,
  children,
}: {
  open: boolean;
  onToggle: (open: boolean) => void;
  title: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
}) {
  const id = React.useId();
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => onToggle(!open)}
        className="flex h-9 w-full items-center gap-2 px-2.5 text-left text-13 hover:bg-hover"
      >
        <ChevronRight
          className={cn("h-3.5 w-3.5 shrink-0 text-faint", open && "rotate-90")}
          strokeWidth={2}
        />
        <span className="font-medium text-fg">{title}</span>
        <span className="ml-auto truncate text-12 text-faint">{meta}</span>
      </button>
      {open ? (
        <div id={id} className="px-2.5 pb-3 pt-1">
          {children}
        </div>
      ) : null}
    </div>
  );
}

function SubmitNotice({ notice }: { notice: SubmitResult }) {
  return (
    <p className="flex items-start gap-1.5 text-13 text-subtle">
      {notice.replayed ? (
        <Repeat2 className="mt-[3px] h-3.5 w-3.5 shrink-0 text-info" strokeWidth={2} aria-hidden />
      ) : null}
      {notice.replayed ? (
        <span>
          Same key and body — returned existing application{" "}
          <span className="font-mono text-fg">{shortId(notice.applicationId)}</span>. No new
          registry calls were made.
        </span>
      ) : (
        <span>
          Submitted <span className="font-mono text-fg">{shortId(notice.applicationId)}</span>. The
          worker picks it up within a second.
        </span>
      )}
    </p>
  );
}

function SubmitError({ error }: { error: ApiError }) {
  const title =
    error.status === 409
      ? "This key was already used with a different body"
      : error.status === 422
        ? "The payload failed validation"
        : error.status === 401
          ? "The API key was not accepted"
          : error.status === 0
            ? "Could not reach the API"
            : `Request rejected (${error.status})`;
  const issues = error.issues;
  return (
    <div className="rounded border border-reject/30 bg-reject-tint px-3 py-2.5 text-13">
      <p className="font-medium text-reject">{title}</p>
      {error.status === 409 ? (
        <p className="mt-1 text-fg/80">
          Reuse the key with the identical body to get the original application back, or generate a
          new key.
        </p>
      ) : null}
      {error.body?.detail ? <p className="mt-1 text-fg/80">{error.body.detail}</p> : null}
      {issues.length ? (
        <ul className="mt-1.5 space-y-0.5">
          {issues.map((i, n) => (
            <li key={n} className="text-12 text-fg/80">
              <span className="font-mono">{i.path}</span> — {i.message}
            </li>
          ))}
        </ul>
      ) : null}
      {!error.body && error.raw ? (
        <p className="mt-1 line-clamp-3 font-mono text-12 text-fg/70">{error.raw.slice(0, 300)}</p>
      ) : null}
    </div>
  );
}
