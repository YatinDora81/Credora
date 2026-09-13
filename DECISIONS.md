# DECISIONS

A design record for the merchant onboarding and risk decisioning service. It answers the six
questions the brief asks, and then lists the places where the specification contradicted
itself and what was done about it.

The single structural commitment everything else follows from: **the model converts text into
fields, and deterministic code reading a YAML policy produces the outcome.** There is no code
path by which model output can set a decision. That is what makes a decision auditable,
reproducible from its stored evidence, and un-exploitable by a hostile document.

---

## 1. What I would build differently with three weeks, and what I deliberately left out

**The queue.** An outbox table polled with `FOR UPDATE SKIP LOCKED`, not a broker. A row
sitting at `PENDING` *is* the outbox entry and the worker's claim is the consumer. This is
the right call at this size: it is transactional with the write that created it, so there is
no dual-write problem, and `SKIP LOCKED` already makes multiple worker replicas safe. Moving
to Kafka or SQS later changes one file, and because at-least-once delivery is exactly what
the existing idempotency machinery already defends against, it would not change the
correctness story at all.

**Deliberately left out:** user accounts and RBAC, a policy authoring UI, per-customer
upstream credentials, a dead-letter queue, caching of upstream verifications (the extraction
cache exists; the upstream one does not), metrics and distributed tracing, and any
notification or webhook back to the lender.

**Stack constraints worth naming honestly.** The extraction cache and the token bucket exist
partly because the model runs on a free tier. Both are defensible on their own merits — the
cache is a determinism property, and a rate limiter in front of any metered dependency is
correct regardless — but the free-tier ceiling is what forced them to be built now rather
than later. With a paid key the limiter's ceiling moves and nothing else changes.

The token bucket is **per process**. With several worker replicas it would need to move into
Postgres or Redis. Not built; the single replica makes it moot today.

**With three weeks:** a policy authoring UI with a lint step over a registry of available
checks; an approval trail on policy versions; replay of stored evidence bundles against a
proposed policy version to preview its blast radius before publishing (the evidence bundle is
already stored and hashed, so this is mostly UI); per-upstream circuit breakers instead of
one global one; and an operator view over `UpstreamCall` to see which upstreams are degrading.

---

## 2. How I handled model output I could not trust

Four independent defences, because each fails differently.

**Structurally unparseable.** `ExtractionSchema.safeParse` gates everything. On failure the
call is retried once with the Zod error text appended to the user message; on the second
failure extraction is marked unavailable with `MODEL_OUTPUT_INVALID`, every extraction-sourced
fact becomes `available: false`, and the dependent clauses go `UNDETERMINED`. The pipeline
continues and the application still reaches a terminal state.

**Semantically ungrounded.** Every extracted field must carry a `quote`, and that quote is
string-matched against `field_agent_note + "\n" + document_text` after whitespace, case and
punctuation normalisation. A field whose quote is not in the source is **dropped** — it never
enters the evidence bundle — and is recorded in `extraction.ungrounded[]` so the UI can show
it struck through with "asserted by model, not found in source — discarded". Arrays are
filtered element-wise, not all-or-nothing. `buildEvidence` re-runs the grounding check even
though the extractor already filtered, so a bug in the extractor can only ever *drop* a fact,
never invent one.

**Hostile.** The model has no decision field to set, so a prompt injection has nowhere to go —
this is a property of the output schema, not of the prompt. Detection runs over the raw source
text **independently of the model's own `instruction_attempt` flag**, because a compromised
extractor cannot be trusted to report the attack on itself; either signal raises the concern.
Verified end to end: sample A.2.1 produces a `PROMPT_INJECTION_ATTEMPT` concern and an outcome
identical to A.1.

**The attempt deliberately does not change the outcome.** No clause in either customer's
policy covers document tampering, and inventing an outcome outside the policy is precisely
what the brief forbids. It is surfaced prominently instead. The alternative considered was a
platform-level clause forcing REVIEW on detected tampering — that is something to *propose* to
customers and have them adopt into their policy, not to impose silently.

**Arithmetically untrusted.** The model is forbidden from converting numbers and returns
turnover as a raw string. `normaliseMoney` — pure, and the most heavily tested function in the
repo — does every conversion. This is what catches A.2.2: "45 lakh a month" annualises to
₹5,40,00,000 against a declared ₹1,45,00,000.

---

## 3. How policies are represented, and what changes at 50 customers

One YAML file per customer per version. A clause is a record: `id`, `text`, `check`, `params`,
`requires`, optional `applies_when`, `on_fail`, `on_undetermined`. Minor versions use
`extends` + `overrides`, so `kaveri_capital@3.2.yaml` is six lines and "A2–A8 unchanged from
3.1" is literally true in the file rather than a claim about two files that drifted.

**Why this shape.** The same check functions are reused across customers, so "the same
application under two API keys comes out differently" is *data*, not branching — there is no
`if (customer === 'kaveri')` anywhere in the engine. A policy naming a check that is not in
the `CHECKS` registry throws **at load**, and `validateAllPolicies()` runs at process start, so
a typo fails the deploy rather than one unlucky application at 3am. `requires` is what makes
rule 4 mechanical: the evaluator checks availability before a check ever runs, so a check
function never handles null and can never mistake a missing input for a failing one.

**Adding a customer is data.** Tapti Tradefin, Palar MSME Finance and Vamsadhara Co-operative
Credit were added after the two brief customers with no engine change: one YAML file each built
from checks already in the registry, a seed row with an API key, and an active-version key in the
runtime config allowlist. Their postures differ in thresholds and in where failures route (Tapti
rejects undisclosed units outright, Palar tolerates a 60% overstatement for young businesses,
Vamsadhara sends every exception to its loan committee), and the same A.1 application comes out
REJECTED, APPROVED and REVIEW across the three. A clean applicant (E.1) passes all six policies.

**At 50 customers with 40-page policies,** hand-authored YAML stops scaling — not because the
format breaks, but because the authors change. What is needed: an authoring UI where credit
teams compose clauses from a registry of available checks rather than writing YAML; a lint and
schema-validation gate before publish; a diff view between versions; an approval trail
recording who signed off; and the policy files in git with tagged releases.

An LLM is genuinely useful *at authoring time* — drafting first-pass YAML from 40 pages of
prose, with a human reviewing and the customer signing off. It must never interpret the prose
**at decision time**, because then no two applications share a rulebook and nothing is
auditable. That distinction is the whole design.

---

## 4. How I resolved the silences, and how a customer would find out

The policies never state which failed clause produces REJECT versus REVIEW. Five rules,
applied consistently:

1. **Where the policy states an outcome, it is honoured verbatim.** A5, A6 and A7 say REVIEW;
   B5, B6 and B7 say non-blocking. Those were transcribed, not decided.
2. **A bright-line quantitative threshold failing produces REJECT.** Age, GST status,
   loan-to-turnover ratio, excluded sector. Objectively verifiable; no judgement to exercise.
3. **A discrepancy a human might legitimately explain produces REVIEW.** A3 turnover variance
   is the only clause in this class — a business can have a genuine reason for declared and
   filed turnover to differ.
4. **`UNDETERMINED` follows the customer's stated posture.** Kaveri is conservative and A7
   says failure to verify is REVIEW and never automatic REJECT, so every Kaveri clause maps
   undetermined to REVIEW and `cap_undetermined_at: REVIEW` stops an undetermined clause ever
   producing REJECT. Nexa's B7 says decide on what is available, so every Nexa clause maps
   undetermined to APPROVE and the decision carries `degraded: true` instead.
5. **A concern with no clause covering it never changes the outcome.** Prompt injection,
   source contradictions and turnover contradictions are surfaced, not scored.

**How a customer finds out: they are told, in every decision.** The fully resolved policy
document — every clause, every `on_fail`, every `on_undetermined` — is returned inside every
decision payload under `policy.resolved` and rendered in a collapsible block in the UI. There
is no hidden mapping anywhere in the system. At scale this becomes a signed policy document
the customer approves before their first application is decided.

### The three interpretation calls that change outcomes

- **A3's denominator is the evidenced figure, not the declared one.** ₹1,45,00,000 against
  ₹1,02,00,000 is a 42.2% variance of evidenced but only 29.7% of declared. The clause says
  "within 40% of turnover evidenced by verification sources", so the evidenced figure is the
  basis — and that is the difference between A3 passing and failing on the A.1 sample.
- **B3 is NOT_APPLICABLE rather than zero-tolerance for businesses over 24 months.** The
  clause grants a 100% allowance *for businesses under 24 months old*. Read as a gate, a
  30-month-old business is simply outside its scope; read as a condition, it would impose
  zero tolerance on every mature business, which is plainly not the intent.
- **Absence of an operating address is not an address mismatch.** A5 compares registration
  against operating premises. When the document never mentioned an operating address there is
  no finding to make — and absence of a finding is not a finding. A5 requires only the two
  registration addresses, so a missing operating address cannot flip it to FAIL or to
  UNDETERMINED.

---

## 5. Which tests I would refuse to ship without

Four, because a bug in each is expensive in a way the others are not.

**`money.test.ts` — number normalisation.** It is the only place where free text becomes a
number that a threshold is compared against. A bug here is silent: no error, no log, just a
wrong credit decision that looks perfectly well-reasoned, with a confident explanation
attached. The table includes the `FY 2024-25` trap, where naive parsing returns `2024` as the
turnover.

**`policy.test.ts` — the expected-results table.** Asserts every clause result and every final
outcome for the base sample and its variants across all three policy versions. This is the
product. If `undisclosed_units_present` has its polarity inverted, or `cap_undetermined_at`
stops firing, every decision is wrong and everything else still passes.

**`idempotency.test.ts`.** A double-submitted application is a double credit decision and a
double upstream call. It includes the concurrent case, because the interesting failure is a
race that a sequential test cannot see — two requests both missing the lookup and both
inserting. That is why the constraint is in the database and not in application code.

**`pii.test.ts`.** PAN and GSTIN leaking into logs is a compliance incident, it is silent, and
it is retroactive — by the time anyone notices, the data is in a log aggregator with a
retention policy. It is also the one failure mode you cannot fix forward. The test asserts
against a captured log stream, including PII buried in free text inside nested arrays and
inside error messages, where path-based redaction cannot reach.

---

## 6. What AI tools I used, and where I overrode them

Built with **Claude Code (Opus 5)** orchestrating parallel subagent workflows: one wave for
the foundation (`packages/db`, `packages/core` primitives, the policy engine, the evidence
layer, the chaos mock, Docker), one for the services (API, worker, web console, integration
tests), and a final adversarial review wave in which independent auditors hunted for
violations of the eight rules and every finding was then judged by three skeptics prompted to
refute it. Test authorship was deliberately separated from implementation where it mattered,
so the tests encode the specification rather than the implementation's behaviour.

Where I overrode the tools, and where the tools overrode the spec:

- **The first instinct on any task like this is to ask the model for a decision.** That is
  unauditable, non-reproducible, and directly exploitable by variant A.2.1. It was rewritten
  as a deterministic engine over a YAML policy with the model reduced to a transcriber that
  has no decision field to set. Everything good about this system follows from that one
  inversion.
- **A broker-based pipeline was rejected for an outbox table.** At-least-once delivery would
  have introduced the exact double-processing problem the idempotency requirement exists to
  prevent, and the outbox is transactional with the write that created it.
- **A subagent proposed generating the Gemini `responseSchema` from Zod.** Gemini's schema is
  an OpenAPI 3.0 subset; `.nullable()` emits `anyOf: [..., {type: "null"}]`, which it rejects.
  The Gemini schema is hand-written next to the Zod one, and a drift test asserts the two key
  sets stay identical, since Zod remains the only thing that actually gates data in.
- **A generated test asserted the implementation, not the spec.** When the incorporation-date
  fallback was tightened (see below), the existing test failed. It was rewritten to assert the
  decided behaviour and a converse case was added — not weakened to make the suite green.
- **A model-written `TURNOVER_CONTRADICTION` check was too literal** and depended on which of
  two figures the model happened to pick as `turnover_statement`, making the required A.2.2
  assertion non-deterministic. Replaced with a deterministic scan (below).
- **The `thinkingConfig` fix came from measurement, not intuition.** The cache suite failed
  intermittently; rather than raising the timeout, the call was instrumented and the cause
  measured directly (below).

Where the tools were *right* and worth saying so: a subagent caught that the specification's
GSTIN regex rejects the specification's own fixture, which would have made every request fail
validation. That is the single highest-value finding in the build and it came from an agent
being asked to check conformance literally rather than charitably.

---

## Where the specification contradicted itself

Each of these was a real fork in the road. All are one-line reversals if you disagree.

**1. The GSTIN regex rejects the spec's own sample data.** §24.1 gives
`/^\d{2}[A-Z]{5}\d{4}[A-Z]\d[A-Z\d]Z[A-Z\d]$/`, which requires **16** characters. A real GSTIN
is 15 (2 state + 10 PAN + 1 entity + `Z` + 1 checksum), and the spec's own fixture
`29AAFCS4321K1ZP` is 15. Taken verbatim, every sample payload would return 422 and nothing
would run. The stray `\d` was made optional (`\d?`) — a strict superset of the spec's pattern
that accepts both. Applied identically in the Zod schema and the GSTIN masking regex. *Every
other field of the Zod payload is byte-identical to the spec.*

**2. `Intl.NumberFormat("en-IN")` versus the example strings.** §15 instructs formatting rupee
figures with `en-IN`, which produces Indian grouping (`1,45,00,000`), while its own example
detail strings show Western grouping (`14,500,000`). Both cannot hold. **The named API won**,
and it is applied on *both* surfaces — clause explanations and concern details — because one
product rendering `1,45,00,000` in one panel and `14,500,000` in the next is worse than either
choice. Supporting evidence that the spec's example bodies are illustrative rather than
literal: §24.4's health example reports `"model": "claude-sonnet-4-6"` while `MODEL_NAME` is
`gemini-2.5-flash`. To reverse this, change the locale in `rupees()` in
`packages/core/src/policy/checks.ts` and `group()` in `packages/core/src/evidence.ts`.

**3. §13.1's incorporation-date fallback versus §18's expected results.** §13.1 lists the
extracted date as a fallback when the registry has none. §18 requires that with the upstream
fully down and the model **healthy**, A1–A4 are UNDETERMINED and neither customer is ever
REJECTED. Those hold together only if a document date does not substitute for a failed
verification — and a healthy model *does* return a parseable ISO date from the certificate.

The fallback now fires **only when `upstream !== null`**: a gap-filler inside a successful
verification, never a replacement for one. §18 was not the deciding argument. Under the other
reading, **degrading the registry raises the authority of the applicant's own paperwork** —
anyone able to break the upstream could have a fabricated incorporation date believed. A7 and
B7 exist precisely to route unverifiability to a human instead.

**4. `TURNOVER_CONTRADICTION` is computed from a wider candidate set than §13.2 specifies.**
§13.2 triggers it from `turnover_statement` alone. In A.2.2 both "Rs. 1.45 crore" (document)
and "45 lakh a month" (note) are present, and which one the model returns as
`turnover_statement` is not deterministic — so the required assertion would be flaky. The
concern is instead evaluated over `turnover_statement` **plus every sentence containing the
word "turnover"** in the combined source. A strict superset of the spec's trigger; it makes
A.2.2 deterministic, and it keeps the finding alive when the model is down entirely.
Restricting to sentences containing "turnover" is what stops the loan amount being read as a
turnover figure.

---

## Other decisions worth recording

**An absent `Idempotency-Key` skips idempotency and creates the application** (§23's first
option). A lender retrying without a key gets a second application, which is the honest
outcome of not asking for deduplication. The alternative — rejecting with 400 — is also
defensible; this system is consistent about the first.

**Cross-tenant access returns 404, never 403.** A 403 confirms the id exists, which leaks the
existence of another customer's application. Enforced by every `Application` query carrying
`customerId`; there is no code path that fetches by id alone.

**`FAILED` is never a credit outcome.** It is reserved for *our* failure — an unhandled
exception, or attempts exceeding `WORKER_MAX_ATTEMPTS`. A deadline is never a reason to fail;
it is a reason to decide on less, with unfinished sources simply `available: false`, which the
engine already handles.

**Thinking tokens are disabled for extraction** (`thinkingConfig: { thinkingBudget: 0 }`).
`gemini-2.5-flash` bills thinking against the same `maxOutputTokens` budget. Measured on the
A.1 prompt: default **14,247ms with 2,264 thinking tokens**, versus **4,051ms with 0**. The
default sits right on `MODEL_TIMEOUT_MS=15000`, which made extraction fail intermittently, and
2,264 + 532 tokens against a 4,096 cap means a slightly longer document would finish
`MAX_TOKENS` with truncated JSON. This is not a shortcut: rules 1 and 2 say the model must not
reason, decide or compute — only transcribe text into fields with verbatim quotes. There is
nothing for a thinking budget to buy. Override with `MODEL_THINKING_BUDGET`.

**A rotated Gemini key pool** (`GEMINI_API_KEYS`, entries of `LABEL__SPLIT__KEY`) sits behind
the token bucket, which is applied **per key** — so N keys give N × `MODEL_RPM_LIMIT`. Beyond
the spec, but §3.2's free-tier ceiling is the reason the limiter exists at all. A `429` cools
that key for 60s; a `401`/`403`/`PERMISSION_DENIED` is permanent, so the key is parked for 15
minutes and rotated past *without* spending an attempt. Only labels are ever logged, never key
material.

**The extraction cache is a determinism property, not just a quota workaround.** Model input
is exactly `field_agent_note + "\n" + document_text`, so identical unstructured material yields
an identical extraction, which means the same application decided twice produces the same
evidence bundle and therefore the same outcome. The free-tier headroom is a side effect. It is
bypassed entirely when `MODEL_OUTAGE` is true, so the switch cannot look like a no-op.

**`temperature: 0` reduces variance but does not guarantee determinism** across provider-side
model updates. That is exactly why the decision is computed from the *stored* evidence bundle
and hashed (`evidence_hash`, `policy_hash`) rather than re-derived from the model.

**`loader.ts` is the one file in `packages/core` that touches the filesystem.** Reading policy
YAML needs I/O. It is confined to that file and cached by `customer@version`; `checks`,
`evaluate`, `aggregate` and `hash` remain pure functions of their arguments, which is what lets
the entire decision path be tested without Postgres, without a network, and without a clock.

**`cap_undetermined_at` is defence in depth and is currently unreachable.** Every Kaveri clause
already maps `on_undetermined` to REVIEW, so no undetermined clause can produce REJECT in the
first place. The cap stays because it makes A7's guarantee structural rather than a property
of eight clauses all being written correctly.

**The worker claim loop does not await a batch before claiming the next.** Awaiting made
batches strictly sequential: at `WORKER_BATCH_SIZE=5`, twenty applications became four
sequential batches, each lasting as long as its slowest member, which `UPSTREAM_TOTAL_BUDGET_MS`
caps at 20s — about 80s against the 90s ceiling. Measured runs sat comfortably inside it, but
the margin was structural. Batches now overlap, with concurrency bounded at
`WORKER_BATCH_SIZE × 4` in flight so a deep backlog cannot stampede the upstream.

---

## What the adversarial review found

After the system was built and green, six independent auditors were run against it — one per
lens: model authority, `UNDETERMINED` integrity, tenancy and idempotency, resilience, PII and
secrets, and line-by-line spec conformance. Each raised candidate defects; each candidate was
then judged by three skeptics prompted to **refute** it, and survived only on a majority.

**19 candidates, 5 confirmed, 14 refuted.** All five were real; all five are fixed; each has a
test. They are recorded here because what a review *catches* is part of the design record.

**HIGH — the list endpoint silently dropped applications.** `createdAt` is `TIMESTAMP(3)`, so
twenty concurrent submissions — precisely the assessor's test-3 shape — land several rows on
the same millisecond. Paging with `createdAt < cursor` and no tiebreaker stepped past the
*whole* tie group, making every tied row after the first unreachable from any cursor.
Reproduced on the live stack: **6 of 25 applications invisible to the lender at `limit=1`**.
Now keyset paging on `(createdAt desc, id desc)` with a compound `"<iso>|<id>"` cursor; bare
ISO cursors still accepted. Re-measured: zero lost and zero duplicated at limits 1, 2, 3 and 7
with four tie groups present.

**HIGH — the circuit breaker lost concurrent increments and opened late or never.**
`recordFailure` computed the new counter from a CTE snapshot (`prev.prev_failures + 1`). A CTE
is evaluated against the snapshot taken at the *start* of the statement, so under READ
COMMITTED a statement that blocks on the row lock resumes and re-applies its own stale value.
Two concurrent failures against a counter of 3 both wrote 4. The breaker therefore degraded
exactly when a struggling upstream produces the most concurrent failures — the moment it exists
for. Now a `SELECT ... FOR UPDATE` inside a transaction, which serialises writers properly.
Regression test: ten concurrent failures against a threshold of five must leave the counter at
ten and the circuit OPEN, with the WARN emitted exactly once.

**MEDIUM — a concern quoted text the model invented.** A field's `value` is model-authored and
explicitly allowed to be non-verbatim (the schema asks for an ISO date in
`incorporation_date.value`); only the sibling `quote` is grounded. `TURNOVER_CONTRADICTION`
was quoting `value`, so a model that paraphrased could put a string appearing in neither
document in front of an underwriter, in quotation marks — the exact harm the grounding rule
exists to prevent. The arithmetic still reads `value` (§13.2 unchanged); only the displayed
quote changed. Two regression tests, including one asserting that across all five fixtures
*no* concern ever quotes text absent from its source.

**MEDIUM — a 429 on the HALF_OPEN probe wedged the circuit.** Rule 5 says a 429 is a statement
about our request rate, not the upstream's health, so `recordRateLimited` touches neither the
counter nor the circuit — correct in itself. But when the single HALF_OPEN probe came back
429, the probe was consumed and no outcome was recorded, so the row sat at HALF_OPEN refusing
every caller until the probe TTL expired: sixty seconds of blanket refusal on top of
`BREAKER_OPEN_MS`, caused entirely by our own throttling. A rate-limited probe now *releases*
the probe back to OPEN with its original `openedAt`, so the next caller is granted a fresh one
immediately.

**MEDIUM — the concurrency ceiling counted the wrong unit (a defect introduced by an earlier
fix in this same build).** Removing the sequential-batch cliff meant no longer awaiting each
batch, with an in-flight ceiling to bound concurrency. But `track()` was called once per
*batch* while the gate compared `inFlight.size` against `batchSize × MAX_INFLIGHT_BATCHES`, a
count of *applications* — permitting 20 in-flight batches of 5, i.e. **100 concurrent
pipelines instead of the documented 20**, and 100 concurrent verifications would stampede the
very upstream the breaker protects. Each application is now tracked individually so the units
match the comment.

The fourteen refuted claims are not listed. They were plausible and specific — reserved
concern codes, division by a zero turnover basis, watchdog/pipeline write races, PAN-shaped
keys escaping the masker — and each died because the guard already existed somewhere the
auditor had not read, or the path was unreachable given the evaluator's availability gate.
That ratio is the point of making verification adversarial rather than confirmatory: a single
confident pass would have shipped some of those as "fixes" to code that was already correct.

---

## Prisma 7 instead of the specified Prisma 5

The spec pins Prisma 5 and devotes §3.1 to the one thing it says will break: the Prisma CLI is
a Node program, the `oven/bun` images ship no `node`, and the query engine is a native binary
that must be built for the right libc and linked against `openssl` in the runtime stage — with
the failure mode being an opaque "Unable to require libquery_engine" at the first query rather
than at build time. Hence the three-stage Dockerfile, the pinned `binaryTargets`, and the
"never use Alpine" warning.

This was upgraded to **Prisma 7.10.0** (the latest stable release) at the operator's request.
It is a breaking change, and it deletes that entire hazard class:

- **No native query engine.** Prisma 7 compiles queries with a WASM query compiler and talks to
  Postgres through a *driver adapter* — here `@prisma/adapter-pg` over `pg`. There is no
  `libquery_engine-*.so.node` in the image, so `binaryTargets` is gone from the schema, the
  `openssl` layer is gone from the runtime stage, and the build is no longer
  platform-specific. §3.1's warning no longer has anything to warn about.
- **The connection URL moved out of the schema.** `datasource { url = env("DATABASE_URL") }` is
  rejected in Prisma 7; the URL now lives in `packages/db/prisma.config.ts`, and the client
  receives a configured adapter instead. `package.json#prisma` was removed in the same release,
  so that key is gone too.
- **`prisma generate` must work without a database.** It runs at image build time, where there
  is no `DATABASE_URL` — and `env()` from `prisma/config` throws on a missing variable. The
  config reads `process.env.DATABASE_URL ?? ""` so generation succeeds in the build and
  `migrate deploy` still receives the real URL at run time from the compose `env_file`.

What did NOT change is the part that matters: `packages/db` still owns the schema, the
migrations, the seed and the `FOR UPDATE SKIP LOCKED` claim query; `$queryRaw` with bound
parameters works unchanged through the adapter; and nothing outside `packages/db` imports
`@prisma/client`. The three-stage Dockerfile is kept because the CLI still needs Node for
`generate` and `migrate deploy` — that half of §3.1 is still true.

**Latest stable, not `latest`.** The `latest` dist-tag currently points at `8.0.0-rc.13`, a
release candidate for the Prisma ORM rewrite (contract files and a composer-based client).
Adopting an RC would mean rebuilding `packages/db` against an unreleased API for a system whose
whole point is predictable behaviour under failure. 7.10.0 is the newest released Prisma; the
move to 8 is a follow-up once it ships stable.

---

## A false address mismatch, found only by running the live model

Every earlier check of the A.1 sample ran either against a hand-built evidence bundle or with
`MODEL_OUTAGE=true`, and in both cases clause A5 passed. Run end to end against a real Gemini
extraction, A5 came back **FAIL** on three of the five fixtures — and passed on the other two.
A result that varies with how verbose the model happens to be is not a finding, it is a bug.

The cause: the model extracted `operating_address = "Peenya premises"` from the note
("Visited the Peenya premises on 18 Feb"). Normalised, that is `[peenya, premises]`; only
`peenya` appears in the registered address, giving 50% token overlap against a 60% threshold,
so the clause reported an address mismatch on an application whose addresses agree. Under
Kaveri that is a REVIEW escalation raised by a description of the *same* place.

§15's drop list (`no`, `number`, `plot`, `flat`, `cross`, `road`, `rd`, `street`, `st`) is
plainly a list of address noise words; it simply never enumerated premises-type nouns or
articles. It was extended with `premises`, `godown`, `warehouse`, `office`, `unit`, `branch`,
`building`, `floor`, `site`, `shop`, the positional words `near`/`opp`/`opposite`/`behind`/
`beside`, and the articles `the`/`at`/`in`/`of`/`and`. That is within the rule's evident
intent rather than a change to it.

Genuine mismatches are untouched, which is the part that matters: `"second godown in Tumkur"`,
`"Tumkur"` and `"Whitefield, Bengaluru 560066"` all still mismatch, the last on PIN code.
Regression tests pin both directions.

The lesson is about the test strategy, not the token list. The integration suite runs with the
model stubbed so it never burns quota or depends on a provider — which is right, and which is
exactly why it could not see this. Two of the three defects found late in this build
(this one and the concern-merge bug in `serialise.ts`) were invisible under `MODEL_OUTAGE` and
appeared only on a real extraction. A live-model smoke run over the five fixtures belongs in
the release checklist, separate from the suite that gates every commit.

---

## Appendix A fixtures are verbatim from the brief

The five sample payloads in `packages/core/src/fixtures.ts` are transcribed from Appendix A,
not paraphrased: the same `application_id_external`, `applied_on`, PAN, GSTIN, addresses,
`declared_annual_turnover_inr`, `loan` block (12 months, `working_capital`), the field agent
note, and the A.1 `CERTIFICATE OF INCORPORATION` including `CIN: U51909KA2023PTC145622`. The
UI loads these same objects, and `samples/*.json` is generated from them so the curl examples
in the README submit exactly what the brief specifies.

Two documents are not quoted verbatim in the brief and had to be written: the GST registration
certificates for A.2.2 and A.2.3, which Appendix A describes by the one line each must contain
("Aggregate turnover declared for FY 2024-25: Rs. 1.45 crore (Rupees one crore forty-five lakh
only)", and the Nature of Business Activities line naming virtual digital assets). Those lines
are reproduced exactly; the surrounding certificate is plausible filler.

Worth stating plainly because it bears on the A.1 result: the A.1 document is a certificate of
incorporation carrying no turnover figure and no GSTIN, so the only evidenced turnover comes
from the registry (₹1,02,00,000 against a declared ₹1,45,00,000, a 42.2% variance of
evidenced). The note's "running since 2021" contradicts the document's 11 August 2023, which
is surfaced as SOURCE_CONTRADICTION and never resolved silently; the registry date is what A1
is evaluated against.
