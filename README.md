# TrendView

Takes a demographic (age / gender / country / interests) and returns the social
media trends that demographic is likely consuming right now, each with an
on-demand "Decoder" chat that explains a single trend in plain language.

This is a plain-JavaScript rewrite of the original Lovable / TanStack Start /
Cloudflare app, split into:

- **`client/`** — React + Vite single-page app (the UI).
- **`server/`** — Node.js + Express API that runs the Anthropic agents.

The AI logic (a Researcher agent with web search → a conditional Curator agent,
plus a per-trend Decoder chat) lives in `server/trends.js` and uses
`claude-sonnet-4-6` via the Anthropic SDK.

## Setup

1. Install dependencies (npm workspaces — one install covers client + server):

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env` and set your Anthropic API key:

   ```sh
   cp .env.example .env
   # then edit .env and set ANTHROPIC_API_KEY=sk-ant-...
   ```

## Develop

Runs the Express API (port 3001) and the Vite dev server (port 5173) together;
Vite proxies `/api/*` to the server.

```sh
npm run dev
```

Open http://localhost:5173.

## Production

Build the client, then start the server (which serves the built `client/dist`
and the API from a single origin on port 3001, or `$PORT`):

```sh
npm run build
npm start
```

Open http://localhost:3001.

## Environment

| Variable            | Where    | Purpose                                              |
| ------------------- | -------- | ---------------------------------------------------- |
| `ANTHROPIC_API_KEY` | server   | Required. Used by the trend agents in `trends.js`.   |
| `PORT`              | server   | Optional. Express listen port (default `3001`).      |

## Notes on the rewrite

- The original was server-rendered (TanStack Start on Cloudflare Workers). This
  rewrite is a client-side SPA + REST API, which is behaviorally identical for
  this app (no SSR data-loading or SEO-critical rendering).
- TanStack server functions (`analyzeTrends`, `askAboutTrend`) became the
  `POST /api/analyze-trends` and `POST /api/ask-about-trend` endpoints.
- Unused Lovable scaffolding (shadcn/ui components, Supabase clients,
  react-query) was dropped — the running product never imported it.
