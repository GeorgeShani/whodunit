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

### Old state tokens and the accusation record (#39, known limitation)

- Every state token carries its issue time and is refused once it is **older than 7 days** (each save re-stamps it, so an
  active game never expires). The player sees "*This case file has gone cold, detective…*" and a fresh start. Tokens from
  before this change (no issue time) are accepted until **2026-10-15 UTC**, then expire the same way.
- The "this game was already accused" record (`lib/accused-store.ts`) lives **30 days** in the Runtime Cache, longer than
  any playable token. Vercel documents the Runtime Cache as persisting across deployments, but it is a cache: per region,
  and entries can be evicted. **Residual risk:** within the 7 days a token stays playable, a saved pre-accusation token can
  accuse again if the record was lost (eviction, another region, the cache unavailable). Closing that fully needs a real
  database; it is accepted as a known limitation for a single-player game.
- `GET /api/health` returns `{ ok, runtimeCache: "vercel" | "memory" }`. `"memory"` means the runtime gave the function no
  shared cache, so the limits, the turn claims and the accusation record are per instance only.
