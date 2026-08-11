import { generateObject } from "ai";
import { z } from "zod";
import { resolveModel } from "@/lib/llm/providers";
import type { LLMProvider } from "@/lib/types";
import type { KalshiEvent, KalshiMarket } from "@/lib/kalshi/client";

/**
 * Recover the legs of a HAND-LISTED parlay from its prose rules.
 *
 * MVE parlays publish `mve_selected_legs` as structured data and need none of
 * this. Hand-listed ones state their conditions only in `rules_primary`:
 *
 *   "If ALL of the following Democratic candidates win their 2026 primary
 *    elections: Abdul El-Sayed for Senate in Michigan, ..."
 *
 * so the legs exist as tradeable markets but nothing links them. That is the
 * gap this closes, and it is deliberately split in two:
 *
 *   the model proposes STRUCTURE   which claims exist, which ticker each maps to
 *   the code decides EVERYTHING    existence, tradeability, prices, edge
 *
 * No number the model emits is ever used. A hallucinated ticker fails the
 * existence check; a hallucinated price cannot enter because prices are never
 * read from the model at all. This mirrors how the strategy compiler treats the
 * LLM as a source of a DSL rather than a source of answers.
 */

const ClaimsSchema = z.object({
  // "all" is the only combinator the parlay hedge is valid for. Anything else
  // must refuse to price rather than silently mis-hedge -- see LEG_COMBINATOR.
  combinator: z
    .enum(["all", "any", "unclear"])
    .describe("Does the market need EVERY listed condition (all), at least one (any), or is it unclear?"),
  legs: z
    .array(
      z.object({
        claim: z.string().min(1).describe("One condition, restated as a standalone sentence."),
        keywords: z
          .array(z.string().min(1))
          .min(1)
          .describe("Distinctive search terms: proper nouns, places, offices, years."),
        needs: z
          .enum(["yes", "no"])
          .describe("Whether the parlay needs this condition to happen (yes) or NOT happen (no)."),
      }),
    )
    .min(1)
    .max(12),
});

const MatchesSchema = z.object({
  matches: z.array(
    z.object({
      claimIndex: z.number().int().min(0),
      ticker: z
        .string()
        .describe("Ticker of the market that settles this exact claim, or empty string if none does."),
      confidence: z.enum(["high", "medium", "low"]),
      reasoning: z.string().describe("Why this market settles the claim, or why none of them do."),
    }),
  ),
});

export interface ResolvedLeg {
  claim: string;
  ticker: string;
  title: string;
  needs: "yes" | "no";
  confidence: "high" | "medium" | "low";
  reasoning: string;
}

export interface UnresolvedClaim {
  claim: string;
  reason: string;
  candidatesShown: number;
}

export interface Resolution {
  combinator: "all" | "any" | "unclear";
  legs: ResolvedLeg[];
  unresolved: UnresolvedClaim[];
  /** Set when the resolution cannot be priced, with the reason why. */
  blockedReason: string | null;
  corpusMarkets: number;
}

export class ResolutionError extends Error {}

const STOPWORDS = new Set([
  "the", "a", "an", "of", "in", "on", "for", "to", "and", "or", "will", "be", "is",
  "their", "his", "her", "its", "at", "by", "with", "this", "that", "as", "from",
  "market", "resolve", "resolves", "yes", "no", "if", "then", "all", "following",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

interface Candidate {
  ticker: string;
  title: string;
  score: number;
}

/**
 * Lexical shortlist for one claim.
 *
 * Deliberately dumb and deterministic. Its only job is to cut thousands of
 * markets down to something a model can read, so recall matters far more than
 * precision -- the model does the discriminating afterwards. Scoring is token
 * overlap weighted by inverse document frequency, so a name like "Flanagan"
 * counts for much more than "senate".
 */
export function shortlist(
  keywords: string[],
  corpus: { ticker: string; title: string }[],
  limit = 12,
): Candidate[] {
  const wanted = new Set(keywords.flatMap((k) => tokens(k)));
  if (wanted.size === 0) return [];

  const df = new Map<string, number>();
  const docTokens = corpus.map((m) => {
    const set = new Set(tokens(m.title));
    for (const t of set) if (wanted.has(t)) df.set(t, (df.get(t) ?? 0) + 1);
    return set;
  });

  const scored: Candidate[] = [];
  for (let i = 0; i < corpus.length; i += 1) {
    let score = 0;
    for (const t of wanted) {
      if (!docTokens[i].has(t)) continue;
      // +1 keeps a token that matches every document from scoring zero.
      score += Math.log(corpus.length / ((df.get(t) ?? 0) + 1));
    }
    if (score > 0) scored.push({ ticker: corpus[i].ticker, title: corpus[i].title, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

/** Flatten events into the {ticker,title} corpus the shortlist searches. */
export function buildCorpus(events: KalshiEvent[]): { ticker: string; title: string }[] {
  const out: { ticker: string; title: string }[] = [];
  for (const e of events) {
    for (const m of e.markets ?? []) {
      if (m.status !== "active") continue;
      // Event title carries the subject, market title the specific outcome;
      // a claim usually mentions both, so match against the pair.
      const title = [e.title, m.title, m.yes_sub_title].filter(Boolean).join(" - ");
      out.push({ ticker: m.ticker, title });
    }
  }
  return out;
}

export interface ResolveOptions {
  parlay: KalshiMarket;
  events: KalshiEvent[];
  provider: LLMProvider;
  apiKey: string;
  model?: string;
  candidatesPerClaim?: number;
}

export async function resolveHandListedLegs(opts: ResolveOptions): Promise<Resolution> {
  const { parlay, events, provider, apiKey, model, candidatesPerClaim = 12 } = opts;
  const rules = parlay.rules_primary?.trim();
  if (!rules) {
    throw new ResolutionError("This market publishes no rules text, so its legs cannot be recovered.");
  }

  const languageModel = resolveModel(provider, apiKey, model);
  const corpus = buildCorpus(events);

  const claims = await generateObject({
    model: languageModel,
    schema: ClaimsSchema,
    schemaName: "ParlayClaims",
    schemaDescription: "The individual conditions a hand-listed parlay depends on.",
    system:
      "You break a prediction-market parlay's rules into its individual conditions. " +
      "Extract only what the rules state. Do not infer extra conditions, and do not " +
      "merge two conditions into one. Keywords should be the distinctive proper nouns " +
      "a search engine would need: people, places, offices, years.",
    prompt: `Market title: ${parlay.title ?? ""}\n\nRules:\n${rules}`,
  });

  const { combinator, legs: claimList } = claims.object;

  const shortlists = claimList.map((c) => shortlist(c.keywords, corpus, candidatesPerClaim));

  const matches = await generateObject({
    model: languageModel,
    schema: MatchesSchema,
    schemaName: "ClaimMatches",
    schemaDescription: "Which candidate market settles each claim.",
    system:
      "You match each claim to the ONE candidate market that settles it. Be strict: " +
      "a market that covers a similar but different contest, office, year, or region " +
      "does NOT settle the claim. If no candidate settles a claim exactly, return an " +
      "empty ticker and say why. A wrong match is far worse than no match, because it " +
      "produces a hedge against the wrong contract.",
    prompt: claimList
      .map((c, i) => {
        const cands = shortlists[i];
        const lines = cands.length
          ? cands.map((x) => `    ${x.ticker}  ${x.title}`).join("\n")
          : "    (no candidates found)";
        return `Claim ${i}: ${c.claim}\n  Candidates:\n${lines}`;
      })
      .join("\n\n"),
  });

  // Everything below is verification. Nothing the model said is trusted until
  // it survives a lookup against the corpus we built ourselves.
  const byTicker = new Map(corpus.map((c) => [c.ticker, c]));
  const resolved: ResolvedLeg[] = [];
  const unresolved: UnresolvedClaim[] = [];

  for (let i = 0; i < claimList.length; i += 1) {
    const claim = claimList[i];
    const match = matches.object.matches.find((m) => m.claimIndex === i);
    const ticker = match?.ticker?.trim().toUpperCase() ?? "";
    const candidate = ticker ? byTicker.get(ticker) : undefined;

    if (!match || !ticker) {
      unresolved.push({
        claim: claim.claim,
        reason: match?.reasoning || "No candidate market settles this claim.",
        candidatesShown: shortlists[i].length,
      });
      continue;
    }
    if (!candidate) {
      // The model returned a ticker that was never on its candidate list --
      // the signature of a hallucination. Drop it rather than fetch it.
      unresolved.push({
        claim: claim.claim,
        reason: `Proposed ticker ${ticker} was not among the candidates, so it was rejected.`,
        candidatesShown: shortlists[i].length,
      });
      continue;
    }
    resolved.push({
      claim: claim.claim,
      ticker,
      title: candidate.title,
      needs: claim.needs,
      confidence: match.confidence,
      reasoning: match.reasoning,
    });
  }

  let blockedReason: string | null = null;
  if (combinator !== "all") {
    blockedReason =
      combinator === "any"
        ? "These rules need only ONE condition to hold. The parlay hedge assumes every condition is required, so pricing it that way would be wrong."
        : "The rules do not clearly state whether every condition is required, so the hedge cannot be priced safely.";
  } else if (unresolved.length > 0) {
    blockedReason = `${unresolved.length} of ${claimList.length} conditions could not be matched to a market. A hedge missing a leg is not cheaper, it is unhedged.`;
  } else if (resolved.length === 0) {
    blockedReason = "No conditions were recovered from the rules.";
  } else {
    // Two claims landing on one ticker looks like a full resolution -- nothing
    // is in `unresolved` -- but it is the same missing-leg failure in disguise:
    // the hedge would buy that one market twice while the other condition rode
    // naked. Cheaper-looking and unhedged is the exact trade to refuse.
    const firstClaimFor = new Map<string, string>();
    const collisions: string[] = [];
    for (const leg of resolved) {
      const prior = firstClaimFor.get(leg.ticker);
      if (prior === undefined) firstClaimFor.set(leg.ticker, leg.claim);
      else collisions.push(`${leg.ticker} was matched to both "${prior}" and "${leg.claim}"`);
    }
    if (collisions.length > 0) {
      blockedReason = `${collisions.join("; ")}. Two conditions cannot settle on the same market, so at least one leg would be unhedged.`;
    }
  }

  return { combinator, legs: resolved, unresolved, blockedReason, corpusMarkets: corpus.length };
}
