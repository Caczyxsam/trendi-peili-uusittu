# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

**TrendMirror** — give a demographic (age / gender / country / interests) and get back the
TikTok / Instagram trends and topics that group is likely consuming right now, each with an
on-demand "Decoder" chat that explains one trend in plain language for an older adult.

Plain **JavaScript** (no TypeScript). Two npm-workspace packages:

- **`client/`** — React 19 + Vite single-page app (the UI).
- **`server/`** — Node + Express API that runs the Anthropic agents.

> Provenance: this was rewritten from a Lovable / TanStack Start / Cloudflare **TypeScript**
> app. SSR, Supabase, shadcn/ui, react-query, and Bun/Wrangler were all dropped as unused or
> unnecessary. Don't reintroduce them.

## Commands

Uses **npm workspaces** — run everything from the repo root.

- `npm install` — installs client + server deps.
- `npm run dev` — runs both via `concurrently`: Express on **:3001** and Vite on **:5173**.
  Vite proxies `/api/*` → the server. Open http://localhost:5173. The server uses
  `node --watch`, so editing `server/*.js` auto-restarts it; Vite hot-reloads the client.
- `npm run build` — builds the client to `client/dist`.
- `npm start` — runs the Express server alone; if `client/dist` exists it serves the built
  SPA (with a catch-all fallback to `index.html`) and the API on one origin (`:3001` or `$PORT`).

There is no test suite, type-checker, or linter configured. Verify by running the app.

## Environment

`.env` lives at the **repo root** (gitignored). The server loads it via `dotenv` from `../.env`.

| Variable            | Required | Purpose                                          |
| ------------------- | -------- | ------------------------------------------------ |
| `ANTHROPIC_API_KEY` | yes      | Used by all agents in `server/trends.js`.        |
| `PORT`              | no       | Express listen port (default `3001`).            |

Copy `.env.example` → `.env` and fill in the key. Never commit real keys.

## Architecture

### The product lives in two files

- **`server/trends.js`** — all AI logic. Exports the two handlers and their Zod input schemas.
- **`client/src/App.jsx`** — the entire UI (hero, form, results grid, per-card chat).

Everything else is plumbing: `server/index.js` (Express wiring), `client/src/api.js`
(fetch wrappers), `client/src/index.css` (Tailwind v4 theme tokens), `client/index.html`
(meta tags), `client/src/ErrorBoundary.jsx` (branded render-error fallback).

### The agents (`server/trends.js`)

Two models, on purpose:
- `MODEL` = `claude-sonnet-4-6` — Researcher + Curator (need quality + search reasoning).
- `DECODER_MODEL` = `claude-haiku-4-5-20251001` — the chat Decoder (fast, cheap, short replies).

**`analyzeTrends(data)` → `TrendReport`** is agentic:
1. **Researcher** — a manual loop (`MAX_TURNS = 4`) calling Sonnet with a server-side
   `web_search` tool (`max_uses: 2`) and a `submit_trend_report` custom tool. The model decides
   when to search; the loop resends on `pause_turn`/`tool_use` and terminates when the model
   calls `submit_trend_report`. Output is validated by `reportSchema`.
2. **Curator** (`runCurator`) — same loop pattern, runs **only** when the heuristic
   `needsCuration()` flags the report (low confidence, < 5 items, or a generic-looking title).
   If it fails, fall back to the Researcher's report. Curation hand-off is deterministic, not
   model-decided.

**`askAboutTrend(data)` → `{ reply }`** is the Decoder: a per-trend chat on Haiku 4.5.
Stateless — the client sends the full short history each turn. It has a **conditional**
`web_search` tool (`max_uses: 1`): the system prompt instructs it to answer directly and
search only for current/factual questions (e.g. "is this dangerous?"). Most turns never
search and finish in ~3s; search turns add one round-trip. Same `pause_turn` resume loop
(`MAX_TURNS = 3`).

### Tight coupling — change these together

The prompts, the tool JSON schemas (`submitReportInputSchema`, `submitCuratedReportInputSchema`),
the Zod `reportSchema`, and the rendering in `App.jsx` are one contract. The `TrendReport`
shape (`{ summary, confidence, trends: [{ platform, kind, title, description, why, hashtags,
category, exampleUrl?, exampleLabel?, startedAt? }] }`) must stay consistent across all of them.
`platform` is one of `TikTok` / `Instagram` / `Topic`; `App.jsx` keys colors, icons, and filters
off it.

### Express conventions (`server/index.js`)

Each route is wrapped by `route(schema, handler)`: it Zod-parses the body (→ `400
{"error":"Invalid input."}` on failure), runs the handler, and turns a thrown `Error` into
`500 {"error": err.message}`. The client (`api.js`) throws `Error(data.error)` on non-2xx, so
handler error messages surface directly in the UI. Keep that contract when adding endpoints.

## Gotchas

- **Haiku 4.5 API limits** (why the Decoder differs from the Sonnet agents): it does **not**
  support `output_config.effort`, and server-side tools need `allowed_callers: ["direct"]`
  (no programmatic tool calling). `thinking: { type: "disabled" }` is fine. Don't copy the
  Sonnet call shape onto Haiku.
- **Keep system prompts byte-stable.** They carry `cache_control: { type: "ephemeral" }`; the
  Researcher's prompt deliberately excludes the demographic/date so the tools + system prefix
  cache across requests. Editing the prompt invalidates that cache.
- **The agentic loop pattern** is `client.messages.stream(...)` → `await stream.finalMessage()`,
  push assistant content, resend on `pause_turn`. Reuse it; don't switch to one-shot
  `messages.create` for tool-using calls.
- Server-side `web_search` is billed per search and adds latency — keep `max_uses` low.
