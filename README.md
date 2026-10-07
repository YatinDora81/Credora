# Credora — Merchant Onboarding & Risk Decisioning

A service that takes a loan application from a lender, verifies the business against an
external registry, reads the attached free text with an LLM, evaluates it against that
lender's credit policy, and returns a decision in which **every reason cites a specific
policy clause**.

The model never decides anything. It converts free text into structured fields, and a
deterministic engine reading a YAML policy file produces the outcome. There is no code path
by which model output can set a decision.

---

## Run it

```bash
cp .env.example .env          # add GEMINI_API_KEYS if you want live extraction
docker compose up --build
```

| Service | URL |
|---|---|
| API | http://localhost:3000 |
| Mock registry | http://localhost:4000 |
| Worker health | http://localhost:4100/health |
| Postgres | localhost:5432 (`credora` / `credora`) |

The console is not served by the API. Run it with `bun run --filter web dev` and open
http://localhost:5173: submit a fixture, watch it decide, and read the clause-by-clause
reasoning. Vite proxies `/v1` to the API on port 3000.

### Deploying the console separately

`apps/web` is a static Vite build meant for Vercel (`apps/web/vercel.json`). Set the project's
root directory to `apps/web` and set `VITE_API_BASE_URL` to the API's public URL (no trailing
slash). It is read at build time, so redeploy after changing it. Set `VITE_WORKER_BASE_URL` and
`VITE_UPSTREAM_BASE_URL` to the worker's and mock registry's public URLs too, so the console's
keep-alive reaches them directly (see below); leave either unset to skip that ping.

On the API, set `CORS_ORIGINS` to a comma-separated list of origins allowed to call it, e.g.
`https://credora.vercel.app,https://*.vercel.app`. `*.` matches subdomains (useful for preview
deployments) and `*` allows any origin. It defaults to `http://localhost:5173`.

Without a Gemini key the system still runs end to end — extraction is reported unavailable,
extraction-dependent clauses come back `UNDETERMINED`, and the decision is marked `degraded`.
That is the designed failure mode, not an error.

### Credentials

| What | Value |
|---|---|
| Kaveri Capital API key | `cr_live_kaveri_7f3a9c2e` |
| Nexa Finserv API key | `cr_live_nexa_4b8d1e6a` |
| Tapti Tradefin API key | `cr_live_tapti_28145a1a` |
| Palar MSME Finance API key | `cr_live_palar_7ec8a7b6` |
| Vamsadhara Co-operative Credit API key | `cr_live_vamsadhara_d8c06574` |
| Admin key (API + mock) | `cr_admin_local_only_change_me` |

### Customers

Kaveri Capital and Nexa Finserv come from the brief. The other three were added as policy data
only (a YAML file, a seed row and an active-version key) to show that a new lender needs no
engine change. All names are fictional.

| Customer | Policy | Posture |
|---|---|---|
| Kaveri Capital | `kaveri_capital` 3.1, 3.2 | Conservative; 36 months (24 on 3.2); undetermined never rejects |
| Nexa Finserv | `nexa_finserv` 1.4 | Growth lender; 12 months; decides on what is available, marks it degraded |
| Tapti Tradefin | `tapti_tradefin` 2.0 | Strict trade lender; 24 months; returns within 60 days; undisclosed units are ineligible; excludes import/export |
| Palar MSME Finance | `palar_msme` 1.1 | Inclusive MSME lender; 6 months; young businesses may overstate turnover by up to 60% |
| Vamsadhara Co-operative Credit | `vamsadhara_coop` 1.0 | Member cooperative; every exception goes to the loan committee; rejects only excluded sectors |

Expected outcomes with the registry and the model healthy (the console's scenario dropdown shows
the same table for the selected customer):

| Sample | Kaveri 3.1 | Kaveri 3.2 | Nexa 1.4 | Tapti 2.0 | Palar 1.1 | Vamsadhara 1.0 |
|---|---|---|---|---|---|---|
| A.1, A.2.1, A.2.2 | REJECTED | REVIEW | APPROVED | REJECTED | APPROVED | REVIEW |
| A.2.3 | REJECTED | REJECTED | APPROVED | REJECTED | REJECTED | REJECTED |
| A.2.4 | REJECTED | REVIEW | APPROVED | REVIEW | APPROVED | APPROVED |
| E.1 | APPROVED | APPROVED | APPROVED | APPROVED | APPROVED | APPROVED |

E.1 is not from the brief: a clean, well-established distributor whose facts pass every clause of
every policy, so each customer has a case it approves.

---

## The seven things an assessor runs

### 1. Idempotency — same key twice gives one application

```bash
KEY=$(uuidgen)
for i in 1 2; do
  curl -s -X POST localhost:3000/v1/applications \
    -H 'X-API-Key: cr_live_kaveri_7f3a9c2e' \
    -H "Idempotency-Key: $KEY" \
    -H 'Content-Type: application/json' \
    -d @samples/a1.json | jq -c '{application_id, status}'
done
```

Both calls return the same `application_id`. One `Application` row, one set of upstream calls.
Replaying with a *different* body under the same key returns `409 idempotency_key_reuse`.

### 2. Tenant isolation — A's key against B's id is a 404

```bash
ID=$(curl -s -X POST localhost:3000/v1/applications \
  -H 'X-API-Key: cr_live_nexa_4b8d1e6a' -H 'Content-Type: application/json' \
  -d @samples/a1.json | jq -r .application_id)

curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/v1/applications/$ID \
  -H 'X-API-Key: cr_live_kaveri_7f3a9c2e'      # -> 404, never 403
```

`404` rather than `403` is deliberate: a `403` would confirm the id exists and leak the
existence of another customer's application.

### 3. Twenty applications under chaos — all reach a terminal state

The mock registry defaults to 10% hang, 5% rate-limit, 30% hard failure. Fire twenty and
watch every one land on `APPROVED`, `REVIEW`, `REJECTED` or `FAILED`, with the degraded ones
saying so.

```bash
for i in $(seq 20); do
  curl -s -X POST localhost:3000/v1/applications \
    -H 'X-API-Key: cr_live_kaveri_7f3a9c2e' -H 'Content-Type: application/json' \
    -d @samples/a1.json > /dev/null &
done; wait

sleep 60
curl -s 'localhost:3000/v1/applications?limit=100' \
  -H 'X-API-Key: cr_live_kaveri_7f3a9c2e' | jq -r '.items[] | "\(.status)\t\(.degraded)"' | sort | uniq -c
```

### 4. Every Appendix A variant, under every policy

The five Appendix A fixtures, plus the clean E.1 applicant, are in the console's **Scenario**
dropdown, grouped as baseline, clean approval, adversarial and edge case. Each option shows the
outcome to expect for the selected customer. They live in `packages/core/src/fixtures.ts`. Submit
each under Kaveri and Nexa (and the added customers if you like) and check the cited clause text
against the policy YAML in `packages/core/src/policies/`, or on the console's **Policies** page.

For deterministic output, turn the chaos off first (see §7 below).

### 5. Model-outage switch

```bash
curl -s -X PUT localhost:3000/v1/admin/config \
  -H 'X-Admin-Key: cr_admin_local_only_change_me' \
  -H 'Content-Type: application/json' \
  -d '{"MODEL_OUTAGE":"true"}'
```

Takes effect within two seconds, no redeploy. Extraction reports
`MODEL_OUTAGE_SIMULATED`, the extraction cache is bypassed (so the switch cannot look like a
no-op), extraction-backed clauses go `UNDETERMINED`, and upstream-backed clauses are
unaffected. Set it back to `"false"` to restore.

### 6. Kaveri 3.1 → 3.2 while applications are in flight

```bash
curl -s -X PUT localhost:3000/v1/admin/config \
  -H 'X-Admin-Key: cr_admin_local_only_change_me' \
  -H 'Content-Type: application/json' \
  -d '{"KAVERI_ACTIVE_POLICY_VERSION":"3.2"}'
```

The policy version is pinned on the row at intake. An application created before the flip is
still decided under 3.1 and its decision shows `"version": "3.1"` beside
`"active_version_now": "3.2"`. Applications created after the flip get 3.2, where the
incorporation threshold drops from 36 months to 24 — turning the A.1 sample from `REJECTED`
into `REVIEW`.

### 7. Logs contain no unmasked PII

```bash
docker compose logs api worker | grep -E 'AAFCS4321K|29AAFCS4321K1ZP' && echo LEAK || echo clean
```

Two layers: pino path redaction, plus a serializer of last resort that regex-scans every
string value in every log object, because PAN and GSTIN also appear inside free text —
document bodies, upstream error strings, Zod issue messages. GSTIN is matched first, since a
GSTIN contains a PAN inside it.

---

## Deterministic mode

Force the mock registry to behave, so policy output is reproducible:

```bash
curl -s -X PUT localhost:4000/admin/config \
  -H 'X-Admin-Key: cr_admin_local_only_change_me' \
  -H 'Content-Type: application/json' \
  -d '{"MOCK_FAIL_RATE":0,"MOCK_HANG_RATE":0,"MOCK_RATE_LIMIT_RATE":0}'
```

---

## Policies

```bash
curl -s localhost:3000/v1/policies -H 'X-API-Key: cr_live_kaveri_7f3a9c2e' | jq '{active_version, active_version_source, versions: [.versions[] | {version, active, changed_clauses}]}'
```

Returns only the calling customer's policy versions: each fully resolved, with its hash, the clauses
it changes from the version it extends, and whether it is the active one. `active_version_source`
says where the active version came from (`db` for an admin override, `env`, `default`, or the
customer's `fallback`). The console's **Policies** page reads it once per customer.

## Health

```bash
curl -s localhost:3000/v1/health | jq
```

Always `200` — the body carries the state, not the status code. A monitoring system flapping
your service to "down" because an upstream is degraded is not what you want. Reports the
circuit-breaker state, model reachability, and queue depth.

Every process also answers a cheap liveness check with no database work:

| Service | Endpoint | `status` values |
|---|---|---|
| API | `GET /v1/keepalive` | `ok` when the API and both services below report `ok`, otherwise `degraded` |
| Worker | `GET :4100/health` (`WORKER_PORT`) | `starting` / `ok` / `degraded` (last queue claim failed) / `stalled` / `stopping` |
| Mock registry | `GET :4000/health` | `ok` |

```bash
curl -s localhost:3000/v1/keepalive | jq
```

### Keep-alive without a cron

While anyone has the console open, it sends three requests every two seconds: `GET /v1/keepalive`
to the API, and `GET /health` straight to the worker and the mock registry
(`VITE_WORKER_BASE_URL`, `VITE_UPSTREAM_BASE_URL`; in dev they default to ports 4100 and 4000).
The direct pings are `no-cors` — those services send no CORS headers, so the browser can't read
the reply, but each request still lands as public traffic, so hosts that put idle services to
sleep keep all three awake while the page is open. The status the header shows comes from the
API, which answers for itself and probes the worker's and the mock registry's `/health` in
parallel. Those probes are coalesced: any
number of open tabs cause at most one downstream round per second, each probe times out after
3s, and neither the keep-alive nor its probes are logged per request — only a service going
unreachable or recovering is.

The API finds the others through `WORKER_BASE_URL` and `UPSTREAM_BASE_URL`. Under docker
compose the defaults are right. On a host that only counts public traffic, point both at the
services' public URLs.

---

## Tests

```bash
bun test packages/core      # pure: money, dates, grounding, sectors, injection, policy engine
bun test tests              # integration: needs postgres + mock upstream
```

`bun test tests/keepalive.test.ts` covers the health endpoints and the keep-alive roll-up.

The four that would block a release are number normalisation, the policy-engine table,
idempotency, and PII masking. `DECISIONS.md` says why.

---

## Layout

```
packages/core       pure decision logic — no I/O, no database, no clock. This is what makes
                    a decision reproducible from its stored evidence bundle.
packages/platform   logger (with the PII masking), runtime config and request context —
                    the three things both apps need and neither should own
packages/db         owns Prisma 7: schema, migrations, seed, client (pg driver adapter) and
                    the repository layer, including the SKIP LOCKED claim query
apps/api            HTTP: controllers → services → repositories. Writes a row and returns;
                    no slow work in the request path. JSON only; the UI is deployed separately
apps/worker         claims from the outbox, runs the pipeline services, writes decisions
apps/mock-upstream  a registry that deliberately hangs, resets and rate-limits
apps/web            the one-page console
```

`packages/core` never imports `packages/db`. The policy engine takes an evidence object as an
argument and does not know a database exists. Every database call in either app goes through a
repository in `packages/db`; no controller, service or pipeline stage touches Prisma directly.

See `DECISIONS.md` for the design record: what was left out, how untrusted model output is
handled, how policies are represented, how the policy silences were resolved, and which tests
would block a release.
