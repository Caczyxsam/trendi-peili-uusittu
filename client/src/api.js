// Thin fetch wrapper. Non-2xx responses carry a JSON `{ error }` message that we
// surface as a thrown Error — the same contract the UI relied on when these were
// TanStack server functions called through useServerFn.
async function postJson(url, body) {
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Network error. Please check your connection and try again.");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status}).`);
  }
  return data;
}

export const analyzeTrends = (data) => postJson("/api/analyze-trends", data);
export const askAboutTrend = (data) => postJson("/api/ask-about-trend", data);
