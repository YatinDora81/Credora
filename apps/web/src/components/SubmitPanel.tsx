import * as React from "react";
import { Send, RotateCcw, AlertTriangle, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Spinner } from "@/components/ui/spinner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError, createApplication } from "@/api";
import { FIXTURE_BUTTONS, fixtureJson, type SampleKey } from "@/fixtures";

export const CUSTOMERS = [
  { label: "Kaveri Capital", apiKey: "dv_live_kaveri_7f3a9c2e" },
  { label: "Nexa Finserv", apiKey: "dv_live_nexa_4b8d1e6a" },
] as const;

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

export interface SubmitPanelProps {
  apiKey: string;
  onApiKeyChange: (key: string) => void;
  onSubmitted: (applicationId: string, replayed: boolean) => void;
}

export function SubmitPanel({ apiKey, onApiKeyChange, onSubmitted }: SubmitPanelProps) {
  const [json, setJson] = React.useState(() => fixtureJson("A.1"));
  const [loadedFixture, setLoadedFixture] = React.useState<SampleKey | null>("A.1");
  const [idemKey, setIdemKey] = React.useState(() => uuid());
  const [lastUsedKey, setLastUsedKey] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<ApiError | null>(null);
  const [ok, setOk] = React.useState<string | null>(null);

  const parsed = React.useMemo(() => {
    try {
      return { value: JSON.parse(json) as unknown, error: null as string | null };
    } catch (e) {
      return { value: null, error: (e as Error).message };
    }
  }, [json]);

  function loadFixture(key: SampleKey) {
    setJson(fixtureJson(key));
    setLoadedFixture(key);
    setError(null);
    setOk(null);
  }

  async function submit() {
    if (parsed.error || busy) return;
    setBusy(true);
    setError(null);
    setOk(null);
    const keyUsed = idemKey.trim();
    try {
      const res = await createApplication({
        apiKey,
        idempotencyKey: keyUsed || undefined,
        payload: parsed.value,
      });
      setLastUsedKey(keyUsed || null);
      setIdemKey(uuid());
      setOk(`${res.status} · ${res.application_id}`);
      onSubmitted(res.application_id, false);
    } catch (e) {
      setError(e instanceof ApiError ? e : new ApiError(0, null, String(e)));
    } finally {
      setBusy(false);
    }
  }

  const activeHint = FIXTURE_BUTTONS.find((f) => f.key === loadedFixture)?.hint;

  return (
    <Card>
      <CardHeader>
        <CardTitle>1 · Submit an application</CardTitle>
        <CardDescription>
          POST /v1/applications writes a row and returns 202. Nothing slow happens in the
          request path — the worker does the rest.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
          <div className="space-y-1.5">
            <Label htmlFor="apikey-select">Customer (X-API-Key)</Label>
            <Select value={apiKey} onValueChange={onApiKeyChange}>
              <SelectTrigger id="apikey-select">
                <SelectValue placeholder="Select a customer" />
              </SelectTrigger>
              <SelectContent>
                {CUSTOMERS.map((c) => (
                  <SelectItem key={c.apiKey} value={c.apiKey}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="font-mono text-[11px] text-muted-foreground">{apiKey}</p>
          </div>

          <div className="space-y-1.5">
            <Label>Load a fixture</Label>
            <div className="flex flex-wrap gap-2">
              {FIXTURE_BUTTONS.map((f) => (
                <Button
                  key={f.key}
                  size="sm"
                  variant={loadedFixture === f.key ? "secondary" : "outline"}
                  title={f.hint}
                  onClick={() => loadFixture(f.key)}
                >
                  {f.label}
                </Button>
              ))}
            </div>
            {activeHint ? (
              <p className="text-xs text-muted-foreground">{activeHint}</p>
            ) : null}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="payload">Payload</Label>
            {parsed.error ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                Invalid JSON — {parsed.error}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">valid JSON</span>
            )}
          </div>
          <Textarea
            id="payload"
            spellCheck={false}
            value={json}
            onChange={(e) => {
              setJson(e.target.value);
              setLoadedFixture(null);
            }}
            className={
              parsed.error
                ? "h-64 border-red-500/70 focus-visible:ring-red-500"
                : "h-64"
            }
          />
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="space-y-1.5">
            <Label htmlFor="idem">Idempotency-Key</Label>
            <div className="flex gap-2">
              <Input
                id="idem"
                value={idemKey}
                spellCheck={false}
                className="font-mono text-xs"
                onChange={(e) => setIdemKey(e.target.value)}
              />
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={!lastUsedKey}
                title={
                  lastUsedKey
                    ? `Reuse ${lastUsedKey} — resubmitting the same body returns the same application, a changed body returns 409`
                    : "Submit once first"
                }
                onClick={() => lastUsedKey && setIdemKey(lastUsedKey)}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reuse last key
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                title="New random key"
                onClick={() => setIdemKey(uuid())}
              >
                <KeyRound className="h-3.5 w-3.5" />
                New
              </Button>
            </div>
            {lastUsedKey ? (
              <p className="font-mono text-[11px] text-muted-foreground">
                last used: {lastUsedKey}
              </p>
            ) : null}
          </div>

          <div className="flex items-end">
            <Button onClick={submit} disabled={busy || !!parsed.error} className="w-full md:w-auto">
              {busy ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              Submit
            </Button>
          </div>
        </div>

        {ok ? (
          <div className="rounded-md border border-emerald-600/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
            Accepted — <span className="font-mono">{ok}</span>
          </div>
        ) : null}

        {error ? <ErrorBlock error={error} /> : null}
      </CardContent>
    </Card>
  );
}

function ErrorBlock({ error }: { error: ApiError }) {
  const issues = error.issues;
  const title =
    error.status === 409
      ? "409 — idempotency key reuse"
      : error.status === 422
        ? "422 — payload rejected by validation"
        : error.status === 0
          ? "Request failed"
          : `${error.status} — request rejected`;

  return (
    <div className="rounded-md border border-red-600/45 bg-red-500/10 px-3 py-2.5 text-sm">
      <p className="flex items-center gap-2 font-semibold text-red-700 dark:text-red-300">
        <AlertTriangle className="h-4 w-4" />
        {title}
      </p>
      {error.body?.error ? (
        <p className="mt-1 font-mono text-xs text-red-700 dark:text-red-300">
          {String(error.body.error)}
        </p>
      ) : null}
      {error.body?.message && error.body.message !== error.body.error ? (
        <p className="mt-1 text-xs text-red-700/90 dark:text-red-300/90">
          {String(error.body.message)}
        </p>
      ) : null}
      {error.status === 409 ? (
        <p className="mt-1.5 text-xs text-muted-foreground">
          The same key was already used for a different body. Reuse it with the identical
          body instead and the original application is returned — one application, one set
          of upstream calls.
        </p>
      ) : null}
      {issues.length ? (
        <ul className="mt-2 space-y-1">
          {issues.map((i, n) => (
            <li key={n} className="font-mono text-xs text-red-700 dark:text-red-300">
              <span className="opacity-70">{i.path}</span> — {i.message}
            </li>
          ))}
        </ul>
      ) : null}
      {!error.body && error.raw ? (
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-xs opacity-80">
          {error.raw.slice(0, 800)}
        </pre>
      ) : null}
    </div>
  );
}
