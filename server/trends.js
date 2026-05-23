import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { jsonrepair } from "jsonrepair";

export const inputSchema = z.object({
  age: z.number().int().min(5).max(120),
  gender: z.string().min(1).max(50),
  country: z.string().min(1).max(100),
  interests: z.string().min(1).max(500),
});

const MODEL = "claude-sonnet-4-6";
// The Decoder is a short, conversational explain-this-item task (with at most one
// light search), so it runs on the faster, cheaper Haiku tier rather than Sonnet.
const DECODER_MODEL = "claude-haiku-4-5-20251001";

// Validation schema for the report the model submits via the tool call.
// TrendReport is the shape inferred from this so the server/UI contract stays in one place.
const trendSchema = z.object({
  platform: z.enum(["TikTok", "Instagram", "Topic"]),
  kind: z.enum(["trend", "event", "topic"]),
  title: z.string(),
  description: z.string(),
  why: z.string(),
  hashtags: z.array(z.string()),
  category: z.string(),
  exampleUrl: z.string().optional(),
  exampleLabel: z.string().optional(),
  startedAt: z.string().optional(),
});

const reportSchema = z.object({
  summary: z.string(),
  confidence: z.enum(["high", "medium", "low"]),
  trends: z.array(trendSchema),
});

// Validate a tool-call report, returning the parsed report or null if malformed.
// The model sometimes delivers `trends` as a JSON-encoded string instead of an
// array — sometimes with unescaped inner quotes that won't even re-parse. We fix
// it locally: strict JSON.parse first, then a tolerant jsonrepair pass. Both run
// in-process, so we never pay a slow model round-trip for this common quirk. The
// caller's resubmit loop is only a last resort for other validation failures.
function coerceAndValidateReport(rawInput) {
  let input = rawInput;
  if (input && typeof input.trends === "string") {
    let trends;
    try {
      trends = JSON.parse(input.trends);
    } catch {
      try {
        trends = JSON.parse(jsonrepair(input.trends));
      } catch {
        trends = undefined;
      }
    }
    if (trends !== undefined) input = { ...input, trends };
  }
  const result = reportSchema.safeParse(input);
  return result.success ? result.data : null;
}

// Message we send back when a submit tool call doesn't validate, nudging the
// model to resend correctly. Targets the two failure modes we actually see.
const RESUBMIT_HINT =
  "Your report did not validate. `trends` must be a JSON array of objects — not a string — and every string value must have its inner quotes escaped. Call the submit tool again with a well-formed report.";

// JSON Schema for the client-side tool Claude calls to deliver the final report.
// Mirrors reportSchema; minItems/maxItems keep the model honest about count.
const submitReportInputSchema = {
  type: "object",
  properties: {
    summary: { type: "string", description: "1-2 sentence overview in English" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    trends: {
      type: "array",
      description: "A JSON array of trend objects. Provide it as an actual array — never as a JSON-encoded string.",
      minItems: 4,
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          platform: {
            type: "string",
            enum: ["TikTok", "Instagram", "Topic"],
            description:
              "'TikTok'/'Instagram' for platform-specific viral content; 'Topic' for a subject this demographic specifically cares about (not a general headline).",
          },
          kind: {
            type: "string",
            enum: ["trend", "event", "topic"],
            description:
              "'trend' = social media trend/challenge/sound; 'event' = recent real-world event/news; 'topic' = ongoing conversation the demographic discusses. Use 'topic' for all platform='Topic' items.",
          },
          title: { type: "string" },
          description: { type: "string" },
          why: { type: "string" },
          hashtags: {
            type: "array",
            items: { type: "string" },
            description:
              "Hashtags if relevant (mostly TikTok/Instagram). Use [] for Topic items that have no hashtags.",
          },
          category: { type: "string" },
          exampleUrl: {
            type: "string",
            description:
              "Optional. For TikTok/Instagram, a real example URL you found, or a search/explore URL (https://www.tiktok.com/search?q=... / https://www.instagram.com/explore/tags/...). For Topic items, omit this entirely (topics don't need a link).",
          },
          exampleLabel: {
            type: "string",
            description:
              "Optional. Short English label for the link, e.g. 'Watch example on TikTok'. Omit when there is no exampleUrl.",
          },
          startedAt: {
            type: "string",
            description:
              "Approximate date the trend started, as 'Month YYYY' (e.g. 'March 2024') or 'YYYY'. Estimate from the earliest coverage you found. Omit entirely if you cannot make a reasonable estimate — do not guess.",
          },
        },
        required: ["platform", "kind", "title", "description", "why", "hashtags", "category"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "confidence", "trends"],
  additionalProperties: false,
};

// Frozen system prompt — no demographic, no date. Keeping it byte-stable lets the
// `cache_control` breakpoint below cache the tools + system prefix across requests.
const SYSTEM_PROMPT = `You are "Trend Finder", an expert analyst of current social media trends on TikTok and Instagram, plus the specific topics a given demographic is into.

You have a web_search tool. Trends change weekly, so do ONE broad search (at most two) anchored on the user's TOPICS and age group — start GLOBAL, e.g. "viral [topic] trends [age] [month year]" or "biggest [topic] moments [month year]". If needed, do ONE follow-up search to check what's big within those topics in the user's COUNTRY, e.g. "[topic] trends [country] [month year]". Do NOT search per item, do NOT re-verify, do NOT search exhaustively. Speed matters more than completeness. Prefer real example URLs you saw in results, but a sensible search/explore URL is fine.

HARD RULES — every single item must obey:
1. SPECIFIC, NOT GENERIC. Name the actual song title + artist, the actual creator's @handle, the exact challenge name, the exact news story, the exact match/episode/release. No vague categories like "dance challenges", "gym content", "fashion reels", "celebrity drama" — those are rejected.
2. RECENT. Trends/topics: actively viral in the last 60 days. Events: must have happened in the LAST 30 DAYS relative to today's date given in the user message.
3. TOPIC-ANCHORED. Each item must clearly connect to at least one of the user's stated topics. If a topic is "music", items can be songs/artists/music challenges/fandoms; if "gaming", games/streamers/gaming events; if "fashion", named designers/aesthetics/viral looks. Drop items that don't tie back to the stated topics, even if otherwise viral.
4. Tie each item to WHY this exact demographic cares.

LOCATION PRIORITY — within the stated topics, build the list in this order:
a) GLOBAL first: what is big worldwide right now within these topics for this age group. Most items should be global hits this demographic almost certainly knows.
b) NATIONAL: items within these topics that are also specifically big in the given country (national charts, country-specific creators, country-relevant news, regional fandoms). Only include national items if there are genuinely notable ones — never invent local items to fill a slot.

RETURN about 7 items total, each tagged with one platform value:
- "TikTok" / "Instagram": a specific viral thing on that platform — a named sound (title + artist), a named challenge, a named creator (@handle), or a specific viral format/aesthetic.
- "Topic": a subject THIS demographic in particular is talking about a lot right now — a niche interest, a fandom moment, a creator/celebrity, a game/show/album, a community-specific debate. Set kind="topic" for these.

CRITICAL for Topic items — they must be demographic-SPECIFIC, not general news everyone sees. Exclude broad headlines the whole world is discussing (e.g. major wars, general elections, the economy) UNLESS this exact demographic is unusually engaged with one specific angle of it. A good Topic is something you'd hear THIS group (this age/gender/interests, in this place) discussing that a different demographic likely would not. If a topic would fit "everyone, everywhere", drop it.

Aim for a rough mix (e.g. ~3 TikTok, ~2 Instagram, ~2 Topic), but exact balance does not matter — quality over coverage, do NOT pad the list. Reject any item that could apply to "any youth, any month, any country".

When — and only when — you have searched and are confident in the list, call the submit_trend_report tool EXACTLY ONCE with the final report. Do not write the report as prose; deliver it solely through the tool call. Respond in English.`;

function buildUserMessage(data) {
  const { age, gender, country, interests } = data;
  const today = new Date().toISOString().slice(0, 10);
  return `Today is ${today}.

Demographic:
- Age: ${age}
- Gender: ${gender}
- Country: ${country}
- Interests: ${interests}

Find about 7 of the latest, biggest trends for this demographic — all tied to the listed Interests. Start with ONE global search anchored on those interests + age; if needed, do ONE follow-up search for the country within the same interests. Then call submit_trend_report with the short list.`;
}

const tools = [
  // Server-side tool — Claude runs it on Anthropic's infra and decides when to search.
  // Capped at 1 for fast testing-phase results — each search adds a round-trip and
  // its results re-enter context every turn.
  { type: "web_search_20260209", name: "web_search", max_uses: 1 },
  // Client-side tool — Claude calls this to deliver the structured result.
  {
    type: "custom",
    name: "submit_trend_report",
    description: "Submit the final, structured trend report. Call this exactly once, after researching.",
    input_schema: submitReportInputSchema,
  },
];

// ── Agent 2: the Curator ────────────────────────────────────────────────────
// Reviews the Scout's 4-8 candidates and submits a tightened final list of 3-5.
// Has a small (capped at 2) web_search budget for verifying borderline items;
// most runs use zero searches and just filter + tighten phrasing.

const CURATOR_SYSTEM_PROMPT = `You are "The Curator", a strict editor reviewing a draft list of social media trend candidates for a specific demographic. The candidates were assembled by a researcher who already searched the web; your job is to pick the FINAL strongest items and tighten them.

INPUT: a demographic profile (age/gender/country/interests) and a list of candidate trends. Each has a title, description, why-it-matters, hashtags, and optionally a source URL.

OUTPUT: submit_curated_report with 3-5 final items. Fewer is better than weaker — never pad to reach 5.

SELECT BY (apply in order):
1. SPECIFICITY — keep items that name a real entity: an exact song title + artist, a specific creator (@handle), a named challenge, a named event/match/episode/release. Reject anything that could apply to "any youth, any month, any country" (e.g. "dance challenges", "gym content", "viral fashion reels", "celebrity drama").
2. RECENCY — trends/topics must be plausibly active in the last 60 days; events in the last 30 days relative to today's date.
3. AUDIENCE FIT + TOPIC TIE — the item should plausibly land for THIS demographic AND clearly connect to at least one of the user's stated topics. Cut items that drift off-topic, even if they're broadly viral.
4. MIX — prefer a varied set across TikTok / Instagram / Topic, all else equal.

YOU HAVE A web_search TOOL, capped at 2 uses TOTAL. Use it ONLY when:
- A candidate would otherwise be a top pick but looks borderline (unfamiliar specific name, possibly stale, possibly fabricated).

DO NOT search:
- Items that already cite a credible source URL with a clearly named entity.
- Items you can judge confidently from your knowledge.
- More than 2 items. Skip verification rather than exceed the budget.

EDITING:
- You may tighten title / description / why for clarity and length, and trim or de-duplicate hashtags.
- You may rewrite the summary and adjust confidence to reflect the final list.
- DO NOT invent new named entities, dates, URLs, or facts. If a candidate's exampleUrl is missing, leave it missing — never guess one.

When ready, call submit_curated_report EXACTLY ONCE. Do not write the report as prose. Respond in English.`;

const submitCuratedReportInputSchema = {
  type: "object",
  properties: {
    summary: { type: "string", description: "1-2 sentence overview in English" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    trends: {
      type: "array",
      description: "A JSON array of trend objects. Provide it as an actual array — never as a JSON-encoded string.",
      minItems: 3,
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          platform: {
            type: "string",
            enum: ["TikTok", "Instagram", "Topic"],
            description:
              "'TikTok'/'Instagram' for platform-specific viral content; 'Topic' for a subject this demographic specifically cares about (not a general headline).",
          },
          kind: {
            type: "string",
            enum: ["trend", "event", "topic"],
            description:
              "'trend' = social media trend/challenge/sound; 'event' = recent real-world event/news; 'topic' = ongoing conversation the demographic discusses. Use 'topic' for all platform='Topic' items.",
          },
          title: { type: "string" },
          description: { type: "string" },
          why: { type: "string" },
          hashtags: {
            type: "array",
            items: { type: "string" },
            description: "Hashtags if relevant. Use [] for Topic items that have no hashtags.",
          },
          category: { type: "string" },
          exampleUrl: {
            type: "string",
            description:
              "Optional. Pass through from the candidate if present. Do not invent a URL the candidate did not provide.",
          },
          exampleLabel: {
            type: "string",
            description: "Optional. Pass through or rewrite the candidate's label.",
          },
          startedAt: {
            type: "string",
            description: "Optional. Pass through from the candidate if present. Do not guess.",
          },
        },
        required: ["platform", "kind", "title", "description", "why", "hashtags", "category"],
        additionalProperties: false,
      },
    },
  },
  required: ["summary", "confidence", "trends"],
  additionalProperties: false,
};

const curatorTools = [
  // Same server-side search tool as the Scout, but tightly budgeted — Curator
  // verifies only what it cannot judge from the candidate alone.
  { type: "web_search_20260209", name: "web_search", max_uses: 1 },
  {
    type: "custom",
    name: "submit_curated_report",
    description:
      "Submit the final curated trend report. Call this EXACTLY once after reviewing the candidates.",
    input_schema: submitCuratedReportInputSchema,
  },
];

function buildCuratorUserMessage(demographic, candidates) {
  const today = new Date().toISOString().slice(0, 10);
  const { age, gender, country, interests } = demographic;
  return `Today is ${today}.

Demographic:
- Age: ${age}
- Gender: ${gender}
- Country: ${country}
- Interests: ${interests}

Candidates (${candidates.trends.length}) from the Researcher:
${JSON.stringify(candidates, null, 2)}

Review these and submit your final curated list via submit_curated_report.`;
}

async function runCurator(client, demographic, candidates) {
  const messages = [
    { role: "user", content: buildCuratorUserMessage(demographic, candidates) },
  ];

  // Same agentic loop as the Researcher: server-side web_search returns via
  // pause_turn/tool_use; we resend until the model submits a valid report, and
  // feed an error back if a submission is malformed. MAX_TURNS=4 covers the
  // initial turn + one search + one resubmit + margin.
  const MAX_TURNS = 4;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 4000,
      thinking: { type: "disabled" },
      output_config: { effort: "low" },
      system: [
        { type: "text", text: CURATOR_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      tools: curatorTools,
      messages,
    });

    const response = await stream.finalMessage();
    messages.push({ role: "assistant", content: response.content });

    const submitCall = response.content.find(
      (b) => b.type === "tool_use" && b.name === "submit_curated_report",
    );
    if (submitCall) {
      const parsed = coerceAndValidateReport(submitCall.input);
      if (parsed) return parsed;
      // Malformed submission — feed the error back and let the model resubmit.
      messages.push({
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: submitCall.id, is_error: true, content: RESUBMIT_HINT },
        ],
      });
      continue;
    }

    if (response.stop_reason === "pause_turn" || response.stop_reason === "tool_use") continue;
    break;
  }

  throw new Error("Curator did not return a structured report.");
}

// Cheap heuristic gate: the Researcher's prompt is already strict, so most reports
// ship as-is. During the testing phase the Curator runs ONLY on a clear bad-report
// signal — a generic-looking title — so a second web-searching agent doesn't double
// the latency on otherwise-fine results. (Low confidence and a short list, by
// themselves, no longer trigger it; re-add those checks for stricter curation.)
function needsCuration(report) {
  // Title carries no named-entity signal (capitalized word past the first
  // character, @handle, or #tag) → probably a generic catch-all that the
  // Researcher's own filter missed. "Espresso by Sabrina Carpenter" passes;
  // "Dance challenges" doesn't.
  if (report.trends.some((t) => !/[A-Z]|@\w+|#\w+/.test(t.title.slice(1)))) return true;
  return false;
}

// ── The Decoder (interactive, per-trend chat agent) ──────────────────────────
// Runs ONLY when the user opens the chat under a specific trend card, so we pay
// nothing for trends nobody asks about. Stateless: the client sends the full short
// conversation each turn. Search-free + low effort → cheap and fast for live chat.

const chatTrendSchema = z.object({
  platform: z.string().max(40),
  title: z.string().max(300),
  description: z.string().max(2000),
  why: z.string().max(2000),
  category: z.string().max(120),
  hashtags: z.array(z.string().max(120)).max(30).optional(),
});

export const chatInputSchema = z.object({
  trend: chatTrendSchema,
  audience: z
    .object({
      age: z.number().int().min(5).max(120),
      gender: z.string().max(50),
      country: z.string().max(100),
    })
    .optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(2000),
      }),
    )
    .min(1)
    .max(20),
});

function buildChatSystem(trend, audience) {
  const audienceLine = audience
    ? `\nThe person asking is trying to understand what a ${audience.age}-year-old ${audience.gender} in ${audience.country} is seeing — keep that audience in mind.`
    : "";
  const hashtagLine =
    trend.hashtags && trend.hashtags.length ? `\n- Hashtags: ${trend.hashtags.join(", ")}` : "";
  return `You are "The Decoder", helping an OLDER adult (think a parent or grandparent) understand ONE specific social media item. You are warm, plain-spoken, concise, and never condescending — to the young people OR to the older person asking.

You answer ONLY questions about THIS item:
- Platform: ${trend.platform}
- Title: ${trend.title}
- What it is: ${trend.description}
- Why it matters to this audience: ${trend.why}
- Category: ${trend.category}${hashtagLine}${audienceLine}

How to answer:
- Use everyday language. If you must use slang or jargon, define it.
- Be specific and honest about what it means, how it is correctly used, the context it shows up in, and any real risks or dangers — never downplay or exaggerate.
- Keep replies short (2-4 sentences) unless the user asks for more detail.
- You have a web_search tool. Answer directly from the item details above and your own knowledge. Search ONLY when the user asks something current or factual you cannot answer confidently — e.g. recent incidents, whether it is genuinely dangerous, what people are saying right now — and search at most once, then answer. Do NOT search for general "what does it mean / how is it used" questions.
- If a question is not about this item, gently steer back to it.
Respond in English.`;
}

const decoderTools = [
  // Conditional verification: the Decoder searches only when a question needs
  // current/factual grounding (capped at 1). Most chat turns answer directly and
  // never search, so the common case stays as fast and cheap as a tool-less call.
  // allowed_callers=["direct"] is required because Haiku 4.5 doesn't support
  // programmatic tool calling (the web_search default).
  { type: "web_search_20260209", name: "web_search", max_uses: 1, allowed_callers: ["direct"] },
];

export async function askAboutTrend(data) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is missing on the server.");

  const client = new Anthropic({ apiKey });

  const messages = data.messages.map((m) => ({ role: m.role, content: m.content }));

  try {
    // Same agentic-loop shape as the Researcher/Curator: the server-side web_search
    // can pause the turn (pause_turn), in which case we resend to resume. When the
    // model answers directly (no search), this finishes in a single pass.
    // MAX_TURNS=3 covers a paused search round plus a safety margin.
    const MAX_TURNS = 3;
    let response;
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const stream = client.messages.stream({
        model: DECODER_MODEL,
        max_tokens: 512,
        // Note: Haiku 4.5 does not support output_config.effort (Sonnet/Opus only).
        thinking: { type: "disabled" },
        // Trend details sit in the system prompt — stable within one card's chat,
        // so follow-up questions read it from cache.
        system: [
          { type: "text", text: buildChatSystem(data.trend, data.audience), cache_control: { type: "ephemeral" } },
        ],
        tools: decoderTools,
        messages,
      });

      response = await stream.finalMessage();

      // pause_turn: the server-side search loop paused mid-turn — resend to resume.
      if (response.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: response.content });
        continue;
      }
      break;
    }

    const reply = (response?.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    return { reply: reply || "Sorry, I couldn't come up with an answer for that one." };
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      throw new Error("AI service is busy. Please try again shortly.");
    }
    if (err instanceof Anthropic.APIError) {
      throw new Error(`AI error: ${err.status ?? ""} ${err.message}`.trim());
    }
    throw err;
  }
}

export async function analyzeTrends(data) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is missing on the server.");

  const client = new Anthropic({ apiKey });

  const messages = [
    { role: "user", content: buildUserMessage(data) },
  ];

  // ── Agent 1: the Researcher ──────────────────────────────────────────────
  // Manual agentic loop. Claude searches the web (server-side) as many times as it
  // wants, then signals completion by calling submit_trend_report. pause_turn means
  // the server-side search loop hit its iteration cap — we re-send to resume.
  let report;
  // +1 over the search budget to leave room for one malformed-submit resubmit.
  const MAX_TURNS = 5;
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: 5000,
        // Thinking off + low effort: this is a "find a few latest trends" task,
        // not a reasoning problem. This is the biggest speed/cost lever.
        thinking: { type: "disabled" },
        output_config: { effort: "low" },
        // cache_control on the last system block caches tools + system together.
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools,
        messages,
      });

      const response = await stream.finalMessage();
      messages.push({ role: "assistant", content: response.content });

      const submitCall = response.content.find(
        (b) => b.type === "tool_use" && b.name === "submit_trend_report",
      );
      if (submitCall) {
        const parsed = coerceAndValidateReport(submitCall.input);
        if (parsed) {
          report = parsed;
          break;
        }
        // Malformed submission — feed the error back and let the model resubmit.
        messages.push({
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: submitCall.id, is_error: true, content: RESUBMIT_HINT },
          ],
        });
        continue;
      }

      // pause_turn / tool_use (server-side web_search): loop to let the model continue.
      if (response.stop_reason === "pause_turn" || response.stop_reason === "tool_use") {
        continue;
      }

      // end_turn / refusal / max_tokens without a report — nothing more is coming.
      break;
    }
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      throw new Error("AI service is busy. Please try again shortly.");
    }
    if (err instanceof Anthropic.AuthenticationError) {
      throw new Error("AI authentication failed. Check the server's ANTHROPIC_API_KEY.");
    }
    if (err instanceof Anthropic.APIError) {
      throw new Error(`AI error: ${err.status ?? ""} ${err.message}`.trim());
    }
    throw err;
  }

  if (!report) throw new Error("AI did not return a structured trend report.");

  // ── Agent 2: the Curator (conditional) ──────────────────────────────────
  // Most Scout reports ship as-is — no extra LLM call, no added latency.
  // The Curator only runs when needsCuration() flags something off. If the
  // Curator itself fails structurally, fall back to the unrefined report so
  // a misfiring validator never sinks the request.
  // (The Decoder, askAboutTrend, is a separate per-trend chat agent — not here.)
  if (!needsCuration(report)) return report;

  try {
    return await runCurator(client, data, report);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      throw new Error("AI service is busy. Please try again shortly.");
    }
    if (err instanceof Anthropic.APIError) {
      throw new Error(`AI error: ${err.status ?? ""} ${err.message}`.trim());
    }
    return report;
  }
}
