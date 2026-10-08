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
