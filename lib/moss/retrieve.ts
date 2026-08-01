import { CORPUS, type CorpusDoc } from "../corpus";

export type Retrieval = {
  docName: string;
  ruleId: string;
  excerpt: string;
  latencyMs: number;
  degraded?: boolean;
};

const INDEX = process.env.MOSS_INDEX_NAME ?? "careplan-rules";

/**
 * ─── SMOKE TEST MOSS BEFORE TOUCHING THIS ───────────────────────────────────
 * Their SDK shape is the one thing in this build nobody has used. Run a
 * 10-line create-index / add-doc / query script first, confirm it prints
 * something correct, THEN fill in `queryMoss` below.
 *
 * Everything else in the app imports `retrieve()` only — if the real API
 * looks different from the guess below, this is the only file that changes.
 */
async function queryMoss(query: string): Promise<CorpusDoc | null> {
  const apiKey = process.env.MOSS_API_KEY;
  if (!apiKey) return null;

  const res = await fetch("https://service.usemoss.dev/v1/search", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ index: INDEX, query, top_k: 1 }),
  });

  if (!res.ok) throw new Error(`Moss ${res.status}: ${await res.text()}`);

  const json = await res.json();
  const hit = json?.results?.[0] ?? json?.matches?.[0] ?? json?.data?.[0];
  if (!hit) return null;

  const ruleId = hit.metadata?.ruleId ?? hit.id;
  return CORPUS.find((d) => d.ruleId === ruleId) ?? null;
}

/**
 * Deterministic fallback. Dumb keyword scoring over the same corpus, so the
 * demo still retrieves the *correct* document when Moss is down. Label it
 * "cached" on screen — never present it as live retrieval.
 */
function fallbackQuery(query: string): CorpusDoc {
  const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
  let best = CORPUS[0];
  let bestScore = -1;
  for (const doc of CORPUS) {
    const hay = `${doc.docName} ${doc.text}`.toLowerCase();
    const score = terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      best = doc;
    }
  }
  return best;
}

/** Sentence containing the strongest term match — what gets quoted on screen. */
function excerptFrom(doc: CorpusDoc, query: string): string {
  const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 3);
  const sentences = doc.text.split(/(?<=\.)\s+/);
  let best = sentences[0];
  let bestScore = -1;
  for (const s of sentences) {
    const score = terms.reduce(
      (n, t) => n + (s.toLowerCase().includes(t) ? 1 : 0),
      0
    );
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best.trim();
}

export async function retrieve(query: string): Promise<Retrieval> {
  const t0 = performance.now();
  let doc: CorpusDoc | null = null;
  let degraded = false;

  try {
    doc = await queryMoss(query);
  } catch (err) {
    console.warn("[moss] falling back:", (err as Error).message);
  }

  if (!doc) {
    doc = fallbackQuery(query);
    degraded = true;
  }

  return {
    docName: doc.docName,
    ruleId: doc.ruleId,
    excerpt: excerptFrom(doc, query),
    // Measured here, not reported by the API. This number goes on screen.
    latencyMs: Math.round(performance.now() - t0),
    ...(degraded ? { degraded: true } : {}),
  };
}
