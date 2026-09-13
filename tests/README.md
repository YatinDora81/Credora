# Integration tests

These are the end-to-end suites from spec §28 (tests 8, 9, 10, 11, 12 and 14). They are the
half of the test plan that unit tests cannot reach: idempotency lives in a database
constraint, isolation lives in a `where` clause, pinning lives in a column written at intake,
and PII masking lives in whatever the processes actually print.

Nothing here is mocked. Every suite spawns the **real** API, the **real** worker and the
**real** mock-upstream as child processes (`Bun.spawn`) against the **real** Postgres, and
talks to them only over HTTP and SQL — the same two surfaces an assessor has.

The pure unit tests (§28 tests 1-7 and 13) live beside the code they cover in
`packages/core/src/**/*.test.ts` and are run separately with `bun test packages/core`.

---

## Running them

Prerequisites:

- **Postgres up** and reachable. `docker compose up -d postgres`, or any local instance.
- **Migrations applied and the database seeded**: `bun run db:deploy && bun run db:seed`.
  The suites re-run the seed themselves, but the *schema* must already exist — they
  deliberately never run `migrate reset`, so they can never leave your database needing a
  re-migration.
- Dependencies installed (`bun install`) and the Prisma client generated (`bun run db:generate`).
- **Nothing else pointed at that database.** These suites spawn their own API, worker and mock
  upstream and assume they own the queue. A second worker — a `bun run dev` stack, a docker
  compose `worker` container — will claim these applications with `SKIP LOCKED` and process
  them against *its* upstream; and if it is stopped mid-claim it leaves rows in `PROCESSING`
  until its watchdog reaps them 120 seconds later, which surfaces here as a spurious "did not
  reach a terminal state". Stop the dev stack first: `docker compose stop api worker` or
  Ctrl-C the `bun run dev`.

```bash
# all of them
DATABASE_URL='postgresql://deepvue:deepvue@localhost:5432/deepvue' bun test tests

# one suite
DATABASE_URL='postgresql://deepvue:deepvue@localhost:5432/deepvue' bun test tests/idempotency.test.ts

# with the child processes' logs echoed to your terminal
TEST_VERBOSE=1 DATABASE_URL='...' bun test tests
```

`DATABASE_URL` defaults to `postgresql://deepvue:deepvue@localhost:5432/deepvue`. The
committed `.env` points at the docker-compose service host (`postgres:5432`), which does not
resolve from a host-side run, so the harness rewrites that one value and leaves every other
URL alone.

Ports are allocated per suite from the ephemeral range, so these tests never collide with a
`bun run dev` stack already listening on 3000/4000.

A clean full run takes about a minute on a laptop; `terminal.test.ts` is the long pole, since
it deliberately watches twenty applications fight a hostile upstream. If a suite fails with
"did not reach a terminal state", the error carries a diagnosis — the row's status and attempt
count, the queue breakdown, whether the worker process is still alive and the last fifteen
lines it wrote — which distinguishes a slow decision from a dead worker from a foreign one.

## The model is OFF by default

**Every suite except `cache.test.ts` runs with `MODEL_OUTAGE=true`.** No test depends on a
live Gemini key, no test burns free-tier quota, and no test fails because a provider had a bad
minute. Extraction-dependent clauses (A6/B6) therefore come back `UNDETERMINED` in those
suites, which is a documented, first-class outcome rather than a workaround — it is also the
state the assessor's own "flip the model-outage switch" check produces.

`cache.test.ts` is the single exception, because the cache is what it is testing. It starts
with the model enabled and makes **at most two** model calls. If neither `GEMINI_API_KEYS` nor
`GEMINI_API_KEY` is set it prints an explicit skip message and skips only the live half; the
`MODEL_OUTAGE` half always runs.

## Database hygiene

`helpers.ts` wipes `UpstreamCall`, `IdempotencyRecord`, `Application`, `ExtractionCache` and
`RuntimeConfig` before each suite, then re-runs `packages/db/src/seed.ts` and resets the
circuit-breaker row. Row-level, never schema-level. Suites that change runtime config put it
back in `afterAll`.

---

## The four non-negotiable suites

§28 names four tests to refuse to ship without. Two of them are unit tests in
`packages/core` (`money.test.ts`, `policy.test.ts`); the other two are here:

### `idempotency.test.ts` — §23, assessor test 1

A duplicated POST that creates a second application is not a duplicate row. It is a **second
credit decision on the same merchant** and a second billable verification against someone
else's registry. The failure is silent, it only shows up under retry storms and network
partitions — exactly when you are least able to investigate — and it is unrecoverable after
the fact because both decisions are real.

Proves: same key twice → the same `application_id`, exactly one `Application` row and exactly
one `UpstreamCall` row (a replay triggers no second verification, including a replay sent
*after* the decision); same key with a different body → `409 idempotency_key_reuse`; key
ordering in the body does not change the hash; **two concurrent identical requests** still
produce one row (the `P2002` race the unique constraint exists for); customer A's key `abc`
and customer B's key `abc` are different keys; and a request with no `Idempotency-Key` still
creates normally and writes no record.

### `pii.test.ts` — §25.1/§25.2, assessor test 7

A PAN or GSTIN in a log line is a data-protection incident that is trivially introduced, is
invisible in code review, and survives in every downstream log aggregator, backup and SIEM
index long after the line is deleted. And a pipeline log without `application_id` on it is
undebuggable at the moment you most need it.

Proves, end to end: one full application through the real processes leaves neither
`AAFCS4321K` nor `29AAFCS4321K1ZP` anywhere in the API's or the worker's stdout (nor the mock
upstream's), while the API still returns the real values to the customer — this is masking at
the log sink, not corruption of the record. Every JSON line whose event starts with
`application.` / `upstream.` / `extraction.` / `policy.` / `decision.` carries a non-empty
`application_id`, and the minimum event set from §25.2 is actually emitted.

Proves, as a unit: driving `makeLogger` into an in-memory stream, both identifiers are masked
when nested deep inside an object, when inside an **array**, when inside the **free-text
message string**, when inside an `Error`'s message, stack and `cause` chain, and when buried
mid-sentence in a **document-shaped blob of prose**. That last case is the important one:
path-based redaction structurally cannot catch it, so it is the case that proves the
serializer of last resort exists and works. It also pins the ordering rule — GSTIN masked
before PAN, because a GSTIN contains a PAN.

---

## The other four

### `isolation.test.ts` — §22, assessor test 2

Cross-tenant reads return **404, never 403**, because a 403 confirms the id exists and that
is itself the leak. Checks the exact status code, that the response body never echoes the id,
and that a foreign id and a nonexistent id are **indistinguishable** in status and body —
otherwise the difference is the existence oracle the 404 was supposed to close. Also: Kaveri's
list never contains Nexa's ids at any `limit` or through any `cursor` page; an unknown uuid is
404; a malformed id is 404 or 422 and never 500; a missing key is `401 missing_api_key`; a bad
key is `401 invalid_api_key`; `/v1/health` needs no key; and `/v1/admin/config` is guarded by
`X-Admin-Key` and rejects keys outside the allowlist with 400.

### `pinning.test.ts` — §24.1 steps 4-6 / §21.2 step 5, assessor test 6

The policy version is chosen once, at intake, and never re-read.

**How the race is removed.** The obvious version of this test is a coin flip: the worker polls
once a second, so "flip it while the row is still PENDING" may lose to a claim. So the harness
starts this suite with **no worker process at all** (`startWorker: false`). Nothing can drain
the queue, the row is *provably* still `PENDING` when the flip lands — the test asserts that
against the database — and only then is the worker started. The timing is a fact, not a hope.

Proves: an application created under 3.1 and flipped to 3.2 mid-flight is still decided under
3.1 — `policy.version: "3.1"` beside `policy.active_version_now: "3.2"`, A1 explaining
`"...policy requires at least 36."`, and an outcome of `REJECTED`. A new application created
after the flip pins 3.2, its A1 `PASS`es at the 24-month threshold, and the outcome is
`REVIEW`. Same payload, same minute, two rulebooks. The resolved policy document in the
response still shows `months: 36` for the older one.

### `terminal.test.ts` — §20/§21.2/§21.3, assessor test 3

Twenty applications against an upstream failing 30%, hanging 10% and rate-limiting 5%. Every
one reaches a terminal state inside 90 seconds; nothing is left in `PENDING` or `PROCESSING`;
no application is `FAILED`, because `FAILED` is reserved for *our* failure and upstream chaos
is not ours; degraded decisions carry `degraded: true` **and** at least one `UNDETERMINED`
clause, with the converse also checked so the flag cannot be decoration; at least one
application records more than one `UpstreamCall`, visible to the customer in `upstream_calls`.

**The single most important assertion in the file** is the A7 cap: no Kaveri application may be
`REJECTED` on the strength of `UNDETERMINED` clauses. Every `REJECTED` one must point at a
*determined* clause that actually `FAIL`ed with `on_fail: REJECT`. An engine that conflates
"could not verify" with "failed verification" rejects a queue of good merchants because
someone else's registry was down — and does it quietly, while looking like it is working.

### `cache.test.ts` — §12.4 and §12.3/§24.5

Two applications with byte-identical unstructured text produce one `ExtractionCache` row and
one model call.

**How a cache hit is proven.** Counting rows is not proof — an upsert on a *miss* also leaves
exactly one row. So after the first application is decided, the stored extraction is mutated
to something the model demonstrably did not return (`undisclosed_units: []`) and a second,
textually identical application is submitted. Its A6 comes back `PASS` where the first
application's was `FAIL`. Nothing but the cache could have produced that evidence.

The second half flips `MODEL_OUTAGE` to `true` through `PUT /v1/admin/config` **while a cache
row for that exact text exists**, and asserts extraction still comes back unavailable and A6
still comes back `UNDETERMINED` — this is the assertion that stops the outage switch from
being a no-op that silently serves cached extractions. A1-A4 are unaffected, because they come
from the upstream. The reason code is read tolerantly (`MODEL_NOT_CONFIGURED`,
`MODEL_UNAVAILABLE` and friends are all honest answers); what matters is that the application
still reaches a terminal state and the extraction-dependent clauses are `UNDETERMINED`.

---

## Beyond §28

### `keepalive.test.ts` — service health and keep-alive

The console keeps every process awake by calling `GET /v1/keepalive` every two seconds, so
that endpoint has to stay cheap, public and truthful. The suite starts **without a worker**:
the keep-alive answers `200` with no API key, reports `degraded` and marks the worker
unreachable. It then starts the worker, checks the worker's own `GET /health` (and the mock's),
waits for the roll-up to reach `ok`, fires a burst of twenty calls and asserts they share one
downstream probe, stops the worker again and checks the roll-up notices. Keep-alive requests
must never appear in the API log at `info`.

---

## `helpers.ts` — the harness

| What | How |
|---|---|
| `startHarness(opts)` | boots mock + API (+ worker) on ephemeral ports, cleans and reseeds the DB |
| `opts.modelOutage` | default `true` |
| `opts.startWorker` | default `true`; `false` leaves the queue undrained |
| `opts.chaos` | default `NO_CHAOS`; `DEFAULT_CHAOS` is the §4 0.30/0.10/0.05 |
| `h.post/get/list/health/admin/adminGet` | the HTTP surface, with header control including *omitting* a key |
| `h.setConfig({...})` | `PUT /v1/admin/config` then waits out the 2s config cache (§4.1) |
| `h.setMockRates({fail,hang,rateLimit})` | drives the mock's own `PUT /admin/config` |
| `h.startWorker()` | blocks until the worker's first log line |
| `h.stopWorker()` | stops only the worker; the queue and the other services keep running |
| `h.keepalive()` / `h.workerUrl` | `GET /v1/keepalive`, and the worker's `/health` base URL |
| `h.waitForTerminal(id, key, ms)` | polls until `APPROVED`/`REVIEW`/`REJECTED`/`FAILED` |
| `h.apiLog()` / `h.workerLog()` / `h.jsonLogLines()` | the captured child stdout+stderr |
| `h.stop()` | unconditional teardown; a `process.on("exit")` backstop catches the rest |

Readiness is polled (`/v1/health` for the API, `/health` for the mock, first log line for the
worker) rather than slept on. Child output is pumped continuously so a full pipe can never
block a service mid-test.
