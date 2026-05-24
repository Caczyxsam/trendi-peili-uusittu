import { useState, useEffect } from "react";
import {
  Loader2,
  Sparkles,
  Music2,
  Instagram,
  AlertCircle,
  PlayCircle,
  Calendar,
  MessageCircle,
  Send,
} from "lucide-react";

import { analyzeTrends, askAboutTrend } from "./api.js";

// Playful status lines shown while waiting. Purely cosmetic and client-side —
// they cycle on a timer, make no requests, and cost zero tokens.
const ANALYZE_MESSAGES = [
  "Scrolling the feed so you don't have to…",
  "Searching for what's blowing up right now…",
  "Spotting this week's viral moments…",
  "Sorting the hype from the noise…",
  "Decoding the hashtags…",
  "Peeking at the For You page…",
  "Catching up on the group chat…",
  "Almost got the scoop…",
];

const DECODER_MESSAGES = [
  "Decoding this one…",
  "Translating the internet…",
  "Getting the full story…",
  "Checking the latest…",
];

// Cycle through `messages` while `active`, swapping every `intervalMs`. No network,
// no tokens — just a setInterval that advances a local index.
function useCyclingMessage(messages, active, intervalMs = 2200) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!active) {
      setI(0);
      return;
    }
    setI(0);
    const id = setInterval(() => setI((n) => (n + 1) % messages.length), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, messages]);
  return messages[i];
}

export default function App() {
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("Female");
  const [country, setCountry] = useState("Finland");
  const [interests, setInterests] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [report, setReport] = useState(null);
  const [audience, setAudience] = useState(null);
  const [filter, setFilter] = useState("all");
  const analyzeMsg = useCyclingMessage(ANALYZE_MESSAGES, loading);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setReport(null);
    setLoading(true);
    try {
      const parsedAge = parseInt(age, 10);
      const result = await analyzeTrends({
        age: parsedAge,
        gender,
        country,
        interests,
      });
      setReport(result);
      setAudience({ age: parsedAge, gender, country });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error.");
    } finally {
      setLoading(false);
    }
  };

  const filteredTrends =
    report?.trends.filter((t) => filter === "all" || t.platform === filter) ?? [];

  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <header className="relative overflow-hidden" style={{ background: "var(--gradient-hero)" }}>
        <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_20%_20%,white,transparent_40%),radial-gradient(circle_at_80%_70%,white,transparent_40%)]" />
        <div className="relative mx-auto max-w-5xl px-4 py-14 sm:py-20 text-center text-primary-foreground">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-1.5 text-sm backdrop-blur-sm">
            <Sparkles className="h-4 w-4" />
            <span>AI-powered parenting tool</span>
          </div>
          <h1 className="mt-4 text-4xl sm:text-6xl font-bold tracking-tight">TrendMirror</h1>
          <p className="mt-3 mx-auto max-w-2xl text-base sm:text-lg text-white/90">
            Understand what your child sees on social media — and why it matters to them.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 mt-10 sm:mt-14 pb-20">
        {/* Form card */}
        <form
          onSubmit={onSubmit}
          className="rounded-3xl border border-border bg-card p-6 sm:p-8 shadow-[var(--shadow-glow)]"
          style={{ background: "var(--gradient-card)" }}
        >
          <p className="mb-5 text-sm text-muted-foreground">
            Enter your child's details to see the trends and topics they're likely consuming right now.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Child's age">
              <input
                type="number"
                required
                min={5}
                max={120}
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="e.g. 14"
                className="input"
              />
            </Field>
            <Field label="Child's gender">
              <select value={gender} onChange={(e) => setGender(e.target.value)} className="input">
                <option>Female</option>
                <option>Male</option>
                <option>Other</option>
                <option>Prefer not to say</option>
              </select>
            </Field>
            <Field label="Child's country" className="sm:col-span-2">
              <input
                type="text"
                required
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="e.g. Finland"
                className="input"
              />
            </Field>
            <Field label="Child's interests" className="sm:col-span-2">
              <input
                type="text"
                required
                value={interests}
                onChange={(e) => setInterests(e.target.value)}
                placeholder="e.g. music, sports, fashion"
                className="input"
              />
            </Field>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-4 text-base font-semibold text-primary-foreground shadow-[var(--shadow-glow)] transition hover:opacity-95 disabled:opacity-60"
          >
            {loading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                Analyzing their world…
              </>
            ) : (
              <>
                <Sparkles className="h-5 w-5" />
                Show me their world
              </>
            )}
          </button>
        </form>

        {/* Always-visible disclaimer */}
        <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          Results are an AI estimate based on your child's profile, not real-time platform data. Use as a conversation starter.
        </p>

        {/* Error */}
        {error && (
          <div className="mt-6 rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && !report && (
          <div className="mt-10 flex flex-col items-center justify-center gap-3 py-10 text-muted-foreground">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-sm transition-opacity">{analyzeMsg}</p>
          </div>
        )}

        {/* Results */}
        {report && (
          <section className="mt-10">
            <div className="rounded-3xl border border-border bg-card p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h2 className="text-xl font-bold text-foreground">What they're seeing right now</h2>
                
              </div>
              <p className="mt-3 text-foreground/80">{report.summary}</p>
            </div>

            {/* Filters */}
            <div className="mt-6 flex flex-wrap gap-2">
              <FilterBtn active={filter === "all"} onClick={() => setFilter("all")}>
                All ({report.trends.length})
              </FilterBtn>
              <FilterBtn active={filter === "TikTok"} onClick={() => setFilter("TikTok")}>
                <Music2 className="h-4 w-4" /> TikTok
              </FilterBtn>
              <FilterBtn active={filter === "Instagram"} onClick={() => setFilter("Instagram")}>
                <Instagram className="h-4 w-4" /> Instagram
              </FilterBtn>
              <FilterBtn active={filter === "Topic"} onClick={() => setFilter("Topic")}>
                <MessageCircle className="h-4 w-4" /> Topics
              </FilterBtn>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {filteredTrends.map((t, i) => (
                <TrendCard key={i} trend={t} audience={audience} />
              ))}
            </div>
          </section>
        )}
      </main>

      <style>{`
        .input {
          width: 100%;
          border-radius: 0.875rem;
          border: 1px solid var(--border);
          background: var(--background);
          padding: 0.75rem 0.95rem;
          color: var(--foreground);
          font-size: 0.95rem;
          transition: border-color .15s, box-shadow .15s;
        }
        .input:focus { outline: none; border-color: var(--ring); box-shadow: 0 0 0 4px color-mix(in oklab, var(--ring) 20%, transparent); }
      `}</style>
    </div>
  );
}

function Field({ label, children, className = "" }) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-sm font-medium text-foreground/80">{label}</span>
      {children}
    </label>
  );
}

function FilterBtn({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition ${
        active
          ? "bg-primary text-primary-foreground shadow-[var(--shadow-glow)]"
          : "bg-secondary text-secondary-foreground hover:bg-secondary/70"
      }`}
    >
      {children}
    </button>
  );
}

function ConfidenceBadge({ level }) {
  const map = {
    high: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
    medium: "bg-amber-500/15 text-amber-700 border-amber-500/30",
    low: "bg-rose-500/15 text-rose-700 border-rose-500/30",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold capitalize ${map[level]}`}
    >
      Confidence: {level}
    </span>
  );
}

function TrendCard({ trend, audience }) {
  const platform = trend.platform;
  const platformClass =
    platform === "TikTok"
      ? "bg-tiktok text-tiktok-foreground"
      : platform === "Instagram"
        ? "bg-instagram text-instagram-foreground"
        : "bg-topic text-topic-foreground";
  const PlatformIcon =
    platform === "TikTok" ? Music2 : platform === "Instagram" ? Instagram : MessageCircle;
  const platformLabel = platform === "Topic" ? "Topic" : platform;
  const tagHostPath =
    platform === "TikTok"
      ? "https://www.tiktok.com/tag/"
      : "https://www.instagram.com/explore/tags/";
  // For Topic cards the platform badge already says "Topic" — don't repeat it as a kind chip.
  const kindLabel =
    platform === "Topic"
      ? null
      : trend.kind === "event"
        ? "Event"
        : trend.kind === "topic"
          ? "Topic"
          : "Trend";

  // The Decoder agent — runs on demand, scoped to this one trend.
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMsgs, setChatMsgs] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const decoderMsg = useCyclingMessage(DECODER_MESSAGES, chatLoading);

  const sendChat = async (text) => {
    const q = text.trim();
    if (!q || chatLoading) return;
    const next = [...chatMsgs, { role: "user", content: q }];
    setChatMsgs(next);
    setChatInput("");
    setChatLoading(true);
    try {
      const res = await askAboutTrend({
        trend: {
          platform: trend.platform,
          title: trend.title,
          description: trend.description,
          why: trend.why,
          category: trend.category,
          hashtags: trend.hashtags,
        },
        audience: audience ?? undefined,
        messages: next,
      });
      setChatMsgs([...next, { role: "assistant", content: res.reply }]);
    } catch (err) {
      setChatMsgs([
        ...next,
        { role: "assistant", content: err instanceof Error ? err.message : "Something went wrong." },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const suggestions = ["What is this exactly?", "Should I be worried?", "How do I talk to my child about it?"];

  return (
    <article className="group flex flex-col rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-glow)]">
      <div className="flex items-center justify-between gap-2">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${platformClass}`}
        >
          <PlatformIcon className="h-3.5 w-3.5" />
          {platformLabel}
        </span>
        <div className="flex flex-wrap items-center gap-1.5">
          {kindLabel && (
            <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {kindLabel}
            </span>
          )}
          <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground">
            {trend.category}
          </span>
        </div>
      </div>
      <h3 className="mt-3 text-lg font-bold text-foreground">{trend.title}</h3>
      {trend.startedAt && (
        <div className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3" />
          <span>Started: {trend.startedAt}</span>
        </div>
      )}
      <p className="mt-1.5 text-sm text-foreground/80">{trend.description}</p>

      <div className="mt-3 rounded-xl bg-secondary/60 p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Why it's popular
        </div>
        <p className="mt-1 text-sm text-foreground/80">{trend.why}</p>
      </div>
      {trend.exampleUrl && (
        <a
          href={trend.exampleUrl}
          target="_blank"
          rel="noreferrer"
          className={`mt-3 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition hover:opacity-90 ${platformClass}`}
        >
          <PlayCircle className="h-4 w-4" />
          {trend.exampleLabel || `Watch example on ${platform}`}
        </a>
      )}
      {trend.hashtags?.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {trend.hashtags.map((h, i) => (
            <a
              key={i}
              href={`${tagHostPath}${encodeURIComponent(h.replace(/^#/, ""))}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent hover:bg-accent/20"
            >
              {h.startsWith("#") ? h : `#${h}`}
            </a>
          ))}
        </div>
      )}

      {/* Ask the Decoder — interactive chat scoped to this trend */}
      <div className="mt-4 border-t border-border pt-3">
        <button
          type="button"
          onClick={() => setChatOpen((o) => !o)}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent transition hover:opacity-80"
        >
          <MessageCircle className="h-4 w-4" />
          {chatOpen ? "Hide chat" : "Ask about this"}
        </button>

        {chatOpen && (
          <div className="mt-3 space-y-3">
            {chatMsgs.length > 0 && (
              <div className="space-y-2">
                {chatMsgs.map((m, i) => (
                  <div
                    key={i}
                    className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                      m.role === "user"
                        ? "ml-auto bg-primary text-primary-foreground"
                        : "bg-secondary text-secondary-foreground"
                    }`}
                  >
                    {m.content}
                  </div>
                ))}
              </div>
            )}

            {chatLoading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {decoderMsg}
              </div>
            )}

            {chatMsgs.length === 0 && !chatLoading && (
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => sendChat(s)}
                    className="rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground/80 transition hover:bg-accent/10"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendChat(chatInput);
              }}
              className="flex items-center gap-2"
            >
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask anything about this…"
                className="input flex-1"
              />
              <button
                type="submit"
                disabled={chatLoading || !chatInput.trim()}
                className="inline-flex items-center justify-center rounded-xl bg-primary px-3 py-2.5 text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                aria-label="Send"
              >
                <Send className="h-4 w-4" />
              </button>
            </form>
          </div>
        )}
      </div>
    </article>
  );
}
