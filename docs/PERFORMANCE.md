# Performance: opening a chat

## Symptom

Clicking a lead in the list took seconds before the chat appeared. In the development log, `GET /api/leads/<id>` (the request a click makes) had a median of 2.1 s and a p90 of 5.7 s over 121 requests, with a worst case of 16.8 s.

## Method

Every figure below is labelled **measured** or **assumed**.

1. **Static analysis** of the code before the change: every network round trip each request makes, which ones are serial, and what the browser does between the click and first paint.
2. **Log analysis** of the development server log (1,549 lines). A request counts as *compile-affected* if any `Compiling`/`Compiled` line appeared since the previous request to the same route. This rule is conservative, because global HMR rebuilds count too.
3. **Network baseline** from the development laptop to the Supabase project (ap-northeast-2, Seoul) using `curl`.
4. **Isolated DB benchmark**, independent of the app: read-only supabase-js queries against the live project, 15 runs per case, comparing serial, parallel and single embedded reads.

## Before: round trips per request (static analysis)

Abbreviations: *trip* = one HTTPS request to Supabase; *JWKS* = the signing-key fetch `getClaims()` needs to verify a JWT locally. auth-js caches it in a module-level map for 10 minutes. That cache is lost on every dev recompile and on every serverless cold start. The middleware runs in a separate runtime, so it keeps its own copy.

| Request | Serial trips (warm) | Extra trips (cold / edge cases) | Steps in order |
|---|---|---|---|
| (a) `GET /dashboard` (middleware + SSR) | 1 | +1 JWKS in middleware, +1 JWKS in page, +1 `getUser` if no `reps` row, +1 token refresh if the access token is expiring | middleware `getClaims` (local) → page `getClaims` (local) → `reps` select. Then the client hydrates and starts (b), plus `GET /api/reps` for the owner (2 more serial trips) and a Realtime WebSocket |
| (b) `GET /api/leads` | 2 | +1 JWKS (middleware), +1 JWKS (route), +1 failed column probe per 60 s while the `realtime_analysis` migration was missing | middleware `getClaims` → `requireUser`: `getClaims` + `reps` select → `leads` select (all rows the user can see, 151 for the owner) |
| (c) `GET /api/leads/[id]`, **the click** | 2 | same as (b) | middleware `getClaims` → `reps` select → `leads` row ‖ `messages` (parallel) |
| (d) `POST /api/leads/[id]/messages` | 4 before the response (+1 after) | +3 and a synchronous Gemini call (2.4–5.0 s, measured in log) while the migration was missing | `reps` → `leads` ‖ `messages` → `messages` insert → `leads` update (provisional) → respond; `after()`: Gemini → `leads` update. The client then calls `reload()` = (b) again |

The `reps` lookup is the dependency that forces two serial trips for every API call. It only resolves the caller's name and role, and it runs before the actual read.

### Client, between the click and first paint (before)

1. Click → `setSelectedId` → React renders `LeadDetail` with `key={id}`, so it remounts.
2. The fetch starts only in a `useEffect`, after commit. In development, Strict Mode runs the effect twice and the first request is aborted (the log has 11 back-to-back duplicate lead GETs).
3. Until the response arrives, the panel shows **"Loading lead…"** and grey skeletons. The list already holds that lead's name, company, phone, tag and follow-up date in memory, but none of it is shown.
4. There is **no client cache**: reopening a lead seen seconds earlier repeats the full request. There is **no prefetch on hover or focus**, so the fetch cannot start before the click.
5. After a message is sent, `onChanged` → `reload()` refetches the **whole list** (2 serial trips plus every row), even though the POST response already contains the updated lead.

## Before: measured numbers

### Development log (measured; ms)

| Route | Set | n | min | median | p90 | max |
|---|---|---|---|---|---|---|
| `GET /api/leads/[id]` | warm | 80 | 577 | 1,755 | 3,927 | 16,773 |
| `GET /api/leads/[id]` | compile-affected | 41 | 1,021 | 3,158 | 7,113 | 16,783 |
| `GET /api/leads/[id]` | all | 121 | 577 | 2,065 | 5,716 | 16,783 |
| `GET /api/leads` | warm | 20 | 556 | 1,406 | 3,280 | 4,862 |
| `GET /api/leads` | compile-affected | 36 | 547 | 2,430 | 6,090 | 10,573 |
| `POST …/messages` | warm | 3 | 3,691 | 8,005 | 10,100 | 10,100 |
| `POST …/messages` | compile-affected | 13 | 4,249 | 9,536 | 13,522 | 13,825 |

Compile times from the same log: `Compiled /api/leads/[id]` n=22, median 965 ms, max **12.1 s**. `/api/leads` n=18, median 748 ms, max 5.9 s. `/messages` n=9, median 4.1 s, max 7.9 s. JWKS fetches seen in the traced section of the log: 1,558 ms (middleware, cold) and 963 ms (route, cold). Once cached, `getClaims` took 1–60 ms.

### Network, laptop → Supabase (measured, `curl`, 10 runs each)

| Case | min | median | max |
|---|---|---|---|
| New connection, table read through PostgREST to Postgres (total) | 368 | ~730 | 1,567 |
| TCP connect only | 40 | 48 | 114 |
| Same connection reused (keep-alive), requests 2–10 | 397 | ~415 | 613 |
| First request on that kept-alive connection | | 1,021 | |

TCP connect takes about 45 ms, so the TLS edge is close to the laptop. Each full trip still costs 250–400 ms because the database is in Seoul.

### Isolated DB benchmark (measured, supabase-js, 15 runs, two passes; ms)

| Case | Pass 1 median / p90 | Pass 2 median / p90 |
|---|---|---|
| One trivial query (per-trip cost) | 258 / 585 | 245 / 270 |
| A: 3 serial (reps → lead → messages) | 1,066 / 6,098 | 850 / 1,255 |
| A′: shape before the change (reps → lead ‖ messages) | 624 / 929 | 511 / 632 |
| B: 3 in parallel | 270 / 350 | 302 / 820 |
| C: **1 embedded query** (`leads` + `reps(name)` + `messages(*)`) | 406 / 425 | 255 / 391 |
| D: list, all leads (151 rows) | 451 / 533 | 681 / 1,056 |
| D: list, one rep (38 rows) | 252 / 291 | 338 / 582 |
| E: cold process, first query (DNS + TCP + TLS) | median 796, p90 1,539 (min 451) | |
| E: same client, 2nd / 3rd query | median 318 / 304 | |

Cost grows with the number of *serial* trips, not with the number of queries. One embedded read costs about the same as one trivial query and roughly halves the shape used before the change.

## Findings (ranked root causes)

1. **Development-mode on-demand compilation** (environment-specific). The first request after an edit compiles the route: median 965 ms, up to 12.1 s for the lead route. A third of lead opens (41/121) were affected. Compile-affected median was 3,158 ms versus 1,755 ms warm. This does not happen in a production build.
2. **Serial round trips × high per-trip latency** (code issue, amplified by environment). Every API call did `reps` lookup → data read: 2 serial trips, measured at 511–624 ms median from the laptop (A′) against 255–406 ms for one embedded trip (C). After a send, the POST made 4 serial trips before replying, and the client then refetched the list (2 more).
3. **Auth key fetches on cold module state** (code + environment). `getClaims()` needs JWKS. The middleware and the route each fetch it after every recompile or cold start: 0.96–1.56 s measured in the log. Each request also builds a new server client. A token near expiry adds a refresh trip.
4. **No client cache, no prefetch, no instant header** (code issue). The request starts only after the click and after React commits. Nothing from the already-loaded list row is shown. A revisit repeats the full request. This makes the whole server time visible to the user on every click.
5. **Whole-list refetch after every change** (code issue). `reload()` after a send re-reads every row (151 for the owner, 451–681 ms median for that query alone). It competes with the chat for the same slow link.
6. **Missing-migration compatibility mode** (data/config issue, now resolved in the database). While `analysis_status` was missing (33 warnings in the log), reads paid an extra failed probe every 60 s, and `POST /messages` ran Gemini synchronously (2.4–5.0 s) before replying.
7. **Unattributed remainder** (environment). Warm `GET /api/leads/[id]` in the log (median 1,755 ms) is well above the 2 × ~250 ms the DB benchmark predicts. The rest is dev-server overhead (unminified bundles, source maps, the middleware sandbox, concurrent HMR), Strict Mode double requests and variance in network latency. The traced section shows single `reps` selects from 276 ms to 1,841 ms. The remainder was not broken down further.

## Environment-specific versus code issues

| Factor | Environment-specific | Code issue |
|---|---|---|
| Dev compile spikes (up to 12 s) | yes, dev only | |
| ~250 ms per trip laptop → Seoul | yes | multiplied by the number of serial trips, which the code controls |
| JWKS refetch after recompile | mostly dev; also serverless cold starts | |
| 2 serial trips per read, 4 per send | | yes |
| No cache / prefetch / instant header | | yes |
| Whole-list refetch after a send | | yes |

**Assumption, not measured:** in production the server runs on Vercel `icn1` (Seoul, set in `vercel.json`) and the database is in `ap-northeast-2` (Seoul, according to the pooler host). A server-to-database trip there is typically single-digit milliseconds, so serial trips cost far less than they do from the laptop. Browser → server latency and function cold starts then dominate, which the client-side fixes (instant header, cache, prefetch) address directly.

## After

> Filled in on the final code. Every `TODO-AFTER` is a number to measure with the commands below.

| Metric | Before | After |
|---|---|---|
| Serial Supabase trips, `GET /api/leads/[id]` | 2 (+2 cold JWKS) | TODO-AFTER |
| Serial Supabase trips, `GET /api/leads` | 2 (+2 cold JWKS) | TODO-AFTER |
| Serial Supabase trips, `POST …/messages` before reply | 4 | TODO-AFTER |
| Middleware auth work per request | `getClaims` (+JWKS cold) | TODO-AFTER |
| Click → header visible (name, company, tag) | after response (~0.6–2 s warm dev) | TODO-AFTER |
| Click → chat ready, first open, warm dev | median 1,755 ms (server, log) | TODO-AFTER |
| Click → chat ready, revisit (cached) | same as first open | TODO-AFTER |
| Click → chat ready after hover prefetch | n/a | TODO-AFTER |
| List refetch after a send | full list, 2 trips | TODO-AFTER |
| Production build (`next start`), `GET /api/leads/[id]` median / p90 | not measured | TODO-AFTER |
| Production (Vercel icn1), `GET /api/leads/[id]` median / p90 | not measured | TODO-AFTER |

## How to re-measure

Development log, warm vs compile-affected split (the parser is a short script that applies the rule from *Method*):

```bash
npm run dev 2>&1 | tee dev.log      # then click through several leads
grep -E "GET /api/leads/[0-9a-f-]{36} 200 in" dev.log
grep -E "Compiled /api/leads" dev.log
grep -E "^\[timing\]|^\[sb:" dev.log  # per-stage and per-trip traces (development only)
```

Network baseline (the key is passed through an environment variable and never printed):

```bash
set -a; . ./.env.local; set +a
U="$NEXT_PUBLIC_SUPABASE_URL/rest/v1/reps?select=id&limit=1"
for i in $(seq 10); do
  curl -s -o /dev/null -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" \
    -w "tcp=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total}\n" "$U"
done
# keep-alive: one curl, ten URLs; num_connects=0 on requests 2..10 means the connection was reused
curl -s $(printf -- '-o /dev/null %.0s' $(seq 10)) -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" \
  -w "connects=%{num_connects} total=%{time_total}\n" $(printf "$U %.0s" $(seq 10))
```

Isolated DB benchmark: a read-only supabase-js script run from the repository root with `node --env-file=.env.local bench.js`. It times one trivial query, 3 serial, reps → (lead ‖ messages), 3 parallel, one embedded `leads?select=*,reps(name),messages(*)`, list all vs one rep, and a fresh process's first query versus its second.

Production build: `npm run build && npm run start`, then repeat the clicks and read the browser's Network panel (no compile step, minified bundles).

Click timing in the browser: in DevTools → Performance, record a click on a lead and read the time from the `click` event to the first frame that shows the lead name (header), and to the frame that shows the messages (chat ready).

## Known limits

- All latency was measured from one development laptop. Per-trip cost to Seoul (≈250 ms warm, ≈800 ms on a new connection) varies with the network and over time. Pass 1 of the 3-serial case had a 6 s p90 from transient spikes.
- The log is from a busy development session with frequent edits and HMR, and possibly two browser tabs. It shows the user's experience but is not a controlled benchmark.
- The DB benchmark uses the service-role key, so RLS policies are not evaluated. With the publishable key and a user JWT, RLS adds server-side work per query; it is not expected to change the number of trips.
- Production (Vercel ↔ Supabase in the same region) was not measured. The single-digit-ms per-trip figure is an assumption.
