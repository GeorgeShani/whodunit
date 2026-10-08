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

- Every state token carries its issue time and is refused once it is **older than 7 days** (each save re-stamps it, so an
  active game never expires). The player sees "*This case file has gone cold, detective…*" and a fresh start. Tokens from
  before this change (no issue time) are accepted until **2026-10-15 UTC**, then expire the same way.
- **With `DATABASE_URL` set (the fix):** the `closed_games` table in Postgres is the source of truth for "this game was
  already accused". See [Closed-games database](#closed-games-database-39) below. The residual risk this section used to
  describe (a saved pre-accusation token accusing again after the cache record was evicted, or from another region) is
  **closed**: the row is committed before any verdict leaves the server, and it does not expire or get evicted.
- **Without it (fallback):** the record lives only in the Runtime Cache (`lib/accused-store.ts`, **30 days**, per region,
  evictable), as before: best effort, with the residual risk above. The server logs one warning per process.
- `GET /api/health` returns `{ ok, runtimeCache: "vercel" | "memory", db: "ok" | "unreachable" | "unconfigured" }`.
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

**Only `/api/accuse` and `/api/health` touch the database.** Interrogate, confront, investigate and hints never import it
(enforced by `tests/lib/closed-games-isolation.test.ts`). The model rate limit, the daily cap and the turn claims stay in
the Runtime Cache.

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

### Supabase free projects pause when idle

Free Supabase projects are **paused after about a week without activity**. Symptoms: `/api/health` shows
`"db": "unreachable"`; every accusation gets the 503 "line is down" reply (fail closed); the rest of the game works.
To unpause: Supabase dashboard → the project → **Restore project** (takes a minute or two), then check `/api/health`.

**Keep-awake cron:** `vercel.json` has one daily Vercel Cron (`17 6 * * *` UTC) that calls `GET /api/health`, whose
`SELECT 1` counts as activity. To remove it, delete the `crons` entry (or the whole `vercel.json`, which holds nothing
else) and redeploy. It costs one function call a day and never touches the model.

### Optional: prune old rows

A state token is playable for at most 7 days, so rows older than that can no longer be replayed against. Keeping 90 days
is generous; to prune (by hand in the SQL editor, or a scheduled Supabase job):

```sql
delete from closed_games where closed_at < now() - interval '90 days';
```

