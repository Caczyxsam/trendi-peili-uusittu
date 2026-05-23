import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

import dotenv from "dotenv";
import express from "express";
import { ZodError } from "zod";

import {
  analyzeTrends,
  askAboutTrend,
  inputSchema,
  chatInputSchema,
} from "./trends.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// .env lives at the project root (one level up from server/).
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const app = express();
app.use(express.json({ limit: "1mb" }));

// Wraps an async handler so a thrown Error becomes a JSON error response the
// client can read from `err.message` — mirroring how the old serverFn calls
// surfaced thrown errors to `useServerFn` callers.
function route(schema, handler) {
  return async (req, res) => {
    let data;
    try {
      data = schema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        return res.status(400).json({ error: "Invalid input." });
      }
      return res.status(400).json({ error: "Invalid request." });
    }

    try {
      const result = await handler(data);
      return res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      return res.status(500).json({ error: message });
    }
  };
}

app.post("/api/analyze-trends", route(inputSchema, analyzeTrends));
app.post("/api/ask-about-trend", route(chatInputSchema, askAboutTrend));

// In production, serve the built client (client/dist) and fall back to
// index.html for client-side routing.
const clientDist = path.resolve(__dirname, "../client/dist");
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => {
  console.log(`TrendMirror server listening on http://localhost:${port}`);
});
