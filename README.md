# Deepvue — Merchant Onboarding & Risk Decisioning

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
cp .env.example .env          # add GEMINI_API_KEY (or GEMINI_API_KEYS) if you want live extraction
docker compose up --build
```

| Service | URL |
|---|---|
| API + UI | http://localhost:3000 |
| Mock registry | http://localhost:4000 |
| Postgres | localhost:5432 (`deepvue` / `deepvue`) |

Open http://localhost:3000 for the one-page console: submit a fixture, watch it decide, and
read the clause-by-clause reasoning.

Without a Gemini key the system still runs end to end — extraction is reported unavailable,
extraction-dependent clauses come back `UNDETERMINED`, and the decision is marked `degraded`.
That is the designed failure mode, not an error.

### Credentials

| What | Value |
|---|---|
| Kaveri Capital API key | `dv_live_kaveri_7f3a9c2e` |
| Nexa Finserv API key | `dv_live_nexa_4b8d1e6a` |
| Admin key (API + mock) | `dv_admin_local_only_change_me` |

---

## The seven things an assessor runs

### 1. Idempotency — same key twice gives one application

```bash
KEY=$(uuidgen)
for i in 1 2; do
  curl -s -X POST localhost:3000/v1/applications \
    -H 'X-API-Key: dv_live_kaveri_7f3a9c2e' \
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
  -H 'X-API-Key: dv_live_nexa_4b8d1e6a' -H 'Content-Type: application/json' \
  -d @samples/a1.json | jq -r .application_id)

curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/v1/applications/$ID \
  -H 'X-API-Key: dv_live_kaveri_7f3a9c2e'      # -> 404, never 403
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
    -H 'X-API-Key: dv_live_kaveri_7f3a9c2e' -H 'Content-Type: application/json' \
    -d @samples/a1.json > /dev/null &
done; wait

sleep 60
curl -s 'localhost:3000/v1/applications?limit=100' \
  -H 'X-API-Key: dv_live_kaveri_7f3a9c2e' | jq -r '.items[] | "\(.status)\t\(.degraded)"' | sort | uniq -c
```

### 4. Every Appendix A variant, under both policies

The five fixtures are loadable from the UI's submit panel, and live in
`packages/core/src/fixtures.ts`. Submit each under both API keys and check the cited clause
text against the policy YAML in `packages/core/src/policies/`.

For deterministic output, turn the chaos off first (see §7 below).

### 5. Model-outage switch

```bash
curl -s -X PUT localhost:3000/v1/admin/config \
  -H 'X-Admin-Key: dv_admin_local_only_change_me' \
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
  -H 'X-Admin-Key: dv_admin_local_only_change_me' \
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
  -H 'X-Admin-Key: dv_admin_local_only_change_me' \
  -H 'Content-Type: application/json' \
  -d '{"MOCK_FAIL_RATE":0,"MOCK_HANG_RATE":0,"MOCK_RATE_LIMIT_RATE":0}'
```

---

## Health

```bash
curl -s localhost:3000/v1/health | jq
```

Always `200` — the body carries the state, not the status code. A monitoring system flapping
your service to "down" because an upstream is degraded is not what you want. Reports the
circuit-breaker state, model reachability, and queue depth.

---

## Tests

```bash
bun test packages/core      # pure: money, dates, grounding, sectors, injection, policy engine
bun test tests              # integration: needs postgres + mock upstream
```

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
                    no slow work in the request path. Also serves the built UI
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
