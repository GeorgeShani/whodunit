# Operations

## Cost protection and limits

Every interrogation answer is one paid model turn; every confrontation exchange is **two** (A answers, B reacts).
Before the model is called, `/api/interrogate` and `/api/confront` pass the cost gate (`ai/model-gate.ts`).
`/api/hint`, `/api/investigate` and `/api/accuse` never call the model and are not limited.

| Env var | Default | Behaviour when hit |
| --- | --- | --- |
| `MODEL_DISABLED` | off (`1`/`true`/`yes`/`on` turns it on) | Kill switch. No model calls at all; players get the in-character "quiet" line (HTTP 503) and keep their state. Searching, the notebook, the deterministic contradiction beat, accusing and endings keep working. |
| `MODEL_RATE_LIMIT` | `20` | Model turns per IP per window. Over it: HTTP 429, `Retry-After` header, the line "*X needs a breather, detective. Give them N minutes, then ask again.*", the state token unchanged, the AGAIN button. `0` refuses every turn. |
| `MODEL_RATE_WINDOW_SECONDS` | `600` | The per-IP window (fixed window: counts reset on each 10-minute boundary). |
| `MODEL_DAILY_CAP` | `300` | Model turns per UTC day, all players together. Over it: the in-character "quiet" line (HTTP 503) until UTC midnight, token unchanged. `0` = no model turns. |

Invalid values fall back to the defaults. Changing an env var on Vercel takes effect on the next deployment.


## Case solutions on the server

Blackwood's and Tallyho's solutions are **not** committed: each `cases/<id>/solution.json` is gitignored
and must be supplied as the server-only env var `CASE_SOLUTION_BLACKWOOD` or `CASE_SOLUTION_TALLYHO`
(base64 of the JSON). Never use a `NEXT_PUBLIC_` prefix. The loader reads the file first if present
(local authoring and tests), then this env var. If it is missing or invalid, the case still loads and
accusations fail closed in character (HTTP 503, `accusation_unavailable`) with no technical text and no
crash. Set the var on Preview and Production, then redeploy so the preview build sees it.

For local `npm test` / `validate:strict`, keep a gitignored copy of the file in the case folder (or set
the env var). If neither is present, `validate:strict` skips that case cleanly, and tests that need the
solution skip rather than fail. Older git commits still contain Blackwood's answer.


How it counts:
- A turn is reserved **before** the model call, so a parallel burst is counted. A refused request spends nothing.
- A turn the model never actually saw (the circuit breaker in `ai/grok.ts` answered, or the key is missing) is given back, so an exhausted account cannot lock players out.
- The IP is Vercel's `x-real-ip`, else the first `x-forwarded-for` hop (Vercel sets both at the edge and overwrites client-sent values). Keys store a hash of the IP, not the IP.

Where it is stored, and how it fails:
- The counters live in the **Vercel Runtime Cache** (`lib/runtime-kv.ts`) plus an in-process copy. The cache is **per region and best effort**: it has no atomic increment, entries can be evicted, and exactly simultaneous requests can slip a few turns past a limit.
- **Both limits fail OPEN** if the cache cannot be read (logged as `[model-gate] ... fail open`). The per-IP limit is a courtesy, and failing closed on the daily cap would silence every suspect for every player whenever the cache hiccups. The in-process copy still counts on a warm instance.
- The real money backstop is the **spending limit on the xAI team** (console.x.ai). Keep one set; the in-app limits keep normal abuse well below it.

### One model turn per game state (#40)

The state token is stateless, so the same token sent twice (in parallel or replayed) would buy two model turns and step past
the confrontation caps. `ai/turn-lock.ts` claims "game id + the token's turn counter" before the gate and the model:

| Situation | Response | Model call |
| --- | --- | --- |
| Same state already in flight | HTTP 409 `in_flight`, "*X is still answering your last question, detective.*", the token the client sent | none |
| Same state already answered (within **24 h**) | HTTP 409 `already_answered`, "*I've only just answered that, detective.*", plus the **newest** token that answer produced | none |
| The turn was not answered (model unavailable, rate limited, an exception) | the claim is released at once, so AGAIN with the same token works | — |

An in-flight claim left by a crashed function expires after **90 s**. A brand-new game (no token) is not claimed. Same caveats as
above: concurrent requests on one instance are caught exactly (a synchronous in-process check); across instances a
write-then-read-back check narrows the race; a region change or cache eviction forgets a claim. A cache error fails open.

### Old state tokens and the accusation record (#39)

- Every state token carries its issue time and is refused once it is **older than 30 days** (each save re-stamps it, so an
  active game never expires; this matches `saved_games` row retention). The player sees "*This case file has gone cold, detective…*" and a fresh start. Tokens from
  before this change (no issue time) are accepted until **2026-10-15 UTC**, then expire the same way.
- **With `DATABASE_URL` set (the fix):** the `closed_games` table in Postgres is the source of truth for "this game was
  already accused". See [Closed-games database](#closed-games-database-39) below. The residual risk this section used to
  describe (a saved pre-accusation token accusing again after the cache record was evicted, or from another region) is
  **closed**: the row is committed before any verdict leaves the server, and it does not expire or get evicted.
- **Without it (fallback):** the record lives only in the Runtime Cache (`lib/accused-store.ts`, **30 days**, per region,
  evictable), as before: best effort, with the residual risk above. The server logs one warning per process.
- `GET /api/health` returns `{ ok, runtimeCache: "vercel" | "memory", db: "ok" | "unreachable" | "unconfigured", dbDiagnostic? }`
  (`dbDiagnostic` only when `DATABASE_URL` is set; see "Diagnosing `db: unreachable`" below).
  `runtimeCache: "memory"` means the runtime gave the function no shared cache, so the limits, the turn claims and the
  accusation cache record are per instance only.

## Closed-games database (#39)

One Postgres table (Supabase, free tier), managed with Drizzle:

| column | type | |
| --- | --- | --- |
| `game_id` | text, primary key | the state token's random game id (no IP, account or personal data) |
| `case_id` | text, not null | |
| `outcome` | text, not null | `'won'` or `'lost'` (check constraint) |
| `accused_id` | text | who was accused |
| `closed_at` | timestamptz, default `now()` | |

Row Level Security is **on with no policies**, so Supabase's public Data API (anon / authenticated keys) can neither read
nor write it. The server connects as `postgres`, which bypasses RLS. Code: `db/schema.ts`, `db/client.ts`,
`lib/closed-games.ts`; migrations in `drizzle/` (generated by `npm run db:generate`, i.e. `drizzle-kit generate`).

**`closed_games` is touched only by `/api/accuse`, `/api/health` and `/api/resume`.** Interrogate, confront, investigate, hint and accuse also write `saved_games` (best effort: a failed save is logged and play continues). The model rate limit, the daily cap and the turn claims stay in the Runtime Cache.

### Setup

1. In Supabase: *Connect* → **Transaction pooler** URI (host `…pooler.supabase.com`, **port 6543**), with the database
   password filled in. The client is built for it (`prepare: false`, one connection per instance, 5 s connect timeout).
   Don't use the direct (5432) or session-pooler URI from serverless functions.
2. Apply the migration, either:
   - `DATABASE_URL='<pooler URI>' npm run db:migrate` (or put it in `.env.local`; the script reads the same env files as
     `next dev`). It exits non-zero with a clear message if `DATABASE_URL` is unset, and never prints the URL. Or:
   - paste `drizzle/0000_closed_games.sql` into the Supabase SQL editor (or apply it through the Supabase connector).
     A manual apply leaves **no record** in Drizzle's journal table (`drizzle.__drizzle_migrations`). That is safe: the SQL
     is idempotent (`CREATE TABLE IF NOT EXISTS`; enabling RLS twice is a no-op), so a later `npm run db:migrate`
     re-applies it harmlessly and records it. Running `npm run db:migrate` once after a manual apply is recommended,
     so future migrations start from a recorded baseline. (Tested against real Postgres in-process:
     `tests/lib/closed-games.test.ts`.)
3. Set `DATABASE_URL` (the same pooler URI) in Vercel for **Production** and **Preview**, then redeploy.
4. Check `GET /api/health` → `"db": "ok"`.

### Fail closed vs fail open

| Path | DB problem | Behaviour |
| --- | --- | --- |
| `/api/accuse`, `DATABASE_URL` set | insert fails (unreachable, paused, timeout) | **fail closed**: HTTP 503 `record_unavailable`, `Retry-After: 5`, "*The telephone line to the Yard is down, detective…*", the token **exactly as sent**, nothing decided or cached. The player can accuse again later with the same token. |
| `/api/accuse`, `DATABASE_URL` set | the pre-check read fails | ignored: the insert decides (and fails closed if the DB is really down) |
| `/api/accuse`, `DATABASE_URL` unset | — | **fail open** to the cache-only record (today's behaviour), one warning per process |
| `/api/health` | any | always HTTP 200; reports `db: "unreachable"` (SELECT 1 error or > 3 s) |
| every other route | — | never touches the DB |

How an accusation is decided: the Runtime Cache record is checked first (a fast pre-check that holds the full original
accusation; written through after each commit). On a miss, the closed-games row is read; if it exists, the stored outcome
comes back (409 `case_closed`). Otherwise the accusation is graded and the row inserted with
`INSERT … ON CONFLICT (game_id) DO NOTHING RETURNING`, **before** any verdict is returned. Only the request whose insert
creates the row gets a fresh verdict; a concurrent duplicate gets the stored outcome. A stored **win** replays the win with
the solution. A stored **loss** replays only "lost" and the accused's reaction: no solution, no verdict, no cited clues,
and the token comes back unchanged (it still can never accuse again).

### Diagnosing `db: "unreachable"`

When `DATABASE_URL` is set, `/api/health` includes `dbDiagnostic`, the URL's non-secret SHAPE plus the connection
error class (lib/db-diagnostic.ts). It never contains the URL, host name, user name or password, nor any raw driver
message. Each failure (health probe or accusation) also logs one line, `[db] {"event":"db_unreachable",...}`, with
the same fields.

| Field | Expected | If not |
| --- | --- | --- |
| `hostKind` | `"pooler"` (`*.pooler.supabase.com`) | `"direct"` = `db.<ref>.supabase.co`, IPv6-only, which Vercel can't reach (errorClass is usually `ENOTFOUND` / `ENETUNREACH` / `CONNECT_TIMEOUT`) |
| `port` | `6543` (transaction pooler) | `5432` on the pooler host = session pooler |
| `userShape` | `"postgres.<ref>"` | plain `"postgres"` on the pooler gets `XX000 Tenant or user not found` |
| `poolerHost` | the region shown in Supabase Connect, e.g. `aws-0-<region>` | a wrong region (or `aws-0` vs `aws-1`) also gets `Tenant or user not found` |
| `placeholderPassword` | `false` | the `[YOUR-PASSWORD]` placeholder (or brackets) was pasted literally |
| `passwordNeedsEncoding` | `false` | the password has `@ # / ? :` or similar unencoded: URL-encode it |
| `surroundingQuotes`, `surroundingWhitespace` | `false` | harmless now (trimmed and one pair of quotes stripped before connecting), but fix the value |
| `parseFailed` | `false` | the value is not a URL at all |
| `errorClass` | `null` | `28P01` wrong password, `3D000` wrong database, `CONNECT_TIMEOUT` / `timeout` nothing answering, `ENOTFOUND` DNS |

Changing an env var on Vercel only applies to NEW deployments: redeploy after editing it.

### Supabase free projects pause when idle

Free Supabase projects are **paused after about a week without activity**. Symptoms: `/api/health` shows
`"db": "unreachable"`; every accusation gets the 503 "line is down" reply (fail closed); the rest of the game works.
To unpause: Supabase dashboard → the project → **Restore project** (takes a minute or two), then check `/api/health`.

**Keep-awake cron:** `vercel.json` has one daily Vercel Cron (`17 6 * * *` UTC) that calls `GET /api/health`, whose
`SELECT 1` counts as activity. To remove it, delete the `crons` entry (or the whole `vercel.json`, which holds nothing
else) and redeploy. It costs one function call a day and never touches the model.

### Saved games (`saved_games`)

In-progress (and recently closed) games are stored in a second table, also RLS-on with no policies, server-only via
`DATABASE_URL` (never a `NEXT_PUBLIC_` prefix):

| column | type | |
| --- | --- | --- |
| `game_id` | text, primary key | 128-bit server-minted id (older 96-bit ids still load) |
| `case_id` | text, not null | canonical case id (`_tallyho` is stored/read as `tallyho` after the rename) |
| `state_token` | text, not null | the HMAC-signed v2 token (includes `saveVersion`) |
| `version` | integer, not null | also inside the signed token; part of the compare-and-swap below (#40, #95) |
| `updated_at` | timestamptz, not null, default `now()` | |
| `write_window_start` | timestamptz, not null, default `now()` | per-game write throttle window (#102) |
| `write_window_count` | integer, not null, default 0 | writes in the current window (#102) |

**Every write is one atomic compare-and-swap (#95).** After a state-changing action (investigate, interrogate, present,
confront, hint, accuse) the server writes the new token with
`UPDATE saved_games SET ... WHERE game_id = $1 AND version = $base AND state_token = $baseToken AND <throttle ok>`
(or `INSERT ... ON CONFLICT DO NOTHING` when the action did not start from a stored row), and waits for it before
answering. Only the request that still matches the stored row lands. A request that lost the race is **refused**: it
gets `409 stale_token` with the winner's token, its public snapshot and the in-character `STALE_TOKEN_NOTICE`, never a
`200` at N+1, so two tabs can never fork the save and a losing tab can never overwrite the winner later. Before an
action, any token that is not exactly the stored one (behind it, or diverged at the same or a higher version) is
replaced by the row, with the same notice. A write that throws after a good read (a blip) downgrades the issued token
to offline lineage (below) so it can never be written over the row.

**Throttles (#102).** The per-IP save-path cap (60/min, Runtime Cache) now **fails closed**: if the limiter itself
errors, the request is refused in character ("the cabinet needs a moment", 429) and nothing runs. That counter is per
region, so the cross-region backstop is a per-game cap counted in the row itself: at most 60 writes per 60 s, checked
inside the same conditional `UPDATE`; a refused write is a 429 in character and the row is untouched.

Fallback (the database unconfigured or unreachable) is **same-tab only**. Tokens minted while the cabinet is shut carry
a signed `offline: true` flag, inherited by every token derived from them, and are **never written** to `saved_games`.
The same tab can keep playing from its leftover token. When the cabinet is open again, the stored row is truth: an
offline leftover is ignored (even if its `saveVersion` was pumped higher) and the player gets an in-character notice.
A game that existed only during the outage (no row yet) stays tab-scoped and is not promoted into the cabinet. A
best-effort in-memory high-water mark on each instance may refuse an older token during the outage; it is not shared
across instances and is not a substitute for the row.

`POST /api/resume` (body only: `gameId`, `caseId`, optional leftover `stateToken`; never in a URL) returns the latest
verified token and a public snapshot (no solution, no hidden proof). A closed game is replayed from `closed_games` as
today. If the database is down, resume falls back to a tab-scoped leftover token; without one the player sees an
in-character "cabinet is stuck" line. A hidden or closing tab quietly flushes the latest *online* token to `POST /api/save` (`sendBeacon`, then `fetch({ keepalive: true })`); offline-lineage tokens are not sent, and a repeat of the same version is skipped. Because every online token is already written by its own action, the flush can only create a **missing** row; it never replaces one. Every refusal is a silent `204`; nothing is ever shown to the player. Resume returns `STALE_TOKEN_NOTICE` whenever the stored row is newer than, or diverged from, the leftover token (#96). The title screen shows that line, in character, next to **Continue case**. A tab that fell back to offline tokens and reconnects is sent back to the stored save with the same `STALE_TOKEN_NOTICE`, so the player knows the moves made while the cabinet was shut were rolled back; on a move (investigate, hint, dialogue, confront, accuse) the response also carries the public snapshot of the resulting state, and the client rebuilds its notebook from it next to the notice. An accusation graded straight away on the stored save carries the same notice to the ending screen (shown in character, announced to screen readers).

**Preview-only outage switch (QA).** On a Vercel *preview* only, a request carrying `x-whodunit-test-outage: db-down`
plus the deployment's automation bypass secret in `x-vercel-protection-bypass` (or `x-whodunit-bypass`) makes
`saved_games` and `closed_games` behave as unreachable for that request; `GET /api/health` with the same headers reports
`simulatedOutage: true`. It is checked against `VERCEL_AUTOMATION_BYPASS_SECRET` in constant time and does not exist in
production, development or tests (`lib/test-outage.ts`).

The client stores only `{ gameId, caseId }` in localStorage. A pre-deploy sessionStorage blob is migrated once. Dialogue
transcripts are not restored. The title offers **Continue case**, and **New game** asks for confirmation when a file is
already in progress.

Code: `db/schema.ts`, `lib/saved-games.ts`, `lib/saved-session.ts`, `engine/resume-handler.ts`; migration
`drizzle/0002_saved_games.sql` and `drizzle/0003_saved_games_throttle.sql`. Apply the migrations before deploying the code that writes the table (0003 is additive with defaults, so it is safe to apply ahead of the code). Row retention and
the token max age are both **30 days**; saves prune older rows opportunistically.

### Optional: prune old closed-game rows

`closed_games` is the permanent accusation record and is not auto-pruned. To prune very old rows by hand (SQL editor, or
a scheduled Supabase job):

```sql
delete from closed_games where closed_at < now() - interval '90 days';
```

