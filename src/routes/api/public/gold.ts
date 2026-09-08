import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const TF = z.enum(["15m", "1h", "4h", "1d"]);

const Body = z.object({
  action: z.enum(["snapshot", "analyze", "chat"]),
  timeframe: TF.default("1h"),
  mode: z.enum(["technical", "sentiment", "plan"]).optional(),
  question: z.string().max(4000).optional(),
  chartImage: z.string().max(6_000_000).optional(),
  screenImage: z.string().max(6_000_000).optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(6000) }))
    .max(20)
    .optional(),
});

const MODE_PROMPT: Record<string, string> = {
  technical:
    "Do a full technical read using the smc data: market structure (BOS/CHoCH), premium vs discount of the dealing range, nearest unmitigated FVG and order block, where buy-side and sell-side liquidity rests, the live session/killzone, momentum, and what invalidates the view. Finish with the confluence score and your honest bias.",
  sentiment:
    "Give a macro & sentiment read for gold right now: rates, USD, risk appetite, typical drivers. Be explicit that you have no live news feed and reason from the price action plus general macro knowledge.",
  plan: "Give a concrete trade plan built from the smc data: bias, entry POI (name the OB/FVG), stop loss sized from ATR, TP1/TP2 at the liquidity pools, risk-reward, setup grade with confidence, and conditions to stand aside. If confluence is mixed, say stand aside instead of forcing a setup.",
};

const EXPERT_SYSTEM = `LANGUAGE RULE (highest priority, no exceptions): ALWAYS write every reply 100% in English, even if the user writes in Urdu, Roman Urdu, Hindi, Arabic or any other language. Never mix languages, never translate back, never use non-English words.

REPLY RULE: ALWAYS reply to every single message, no matter what it is — even a simple "Hi", "Hello", a greeting, a joke, or an off-topic question. For greetings, reply warmly (e.g. introduce yourself briefly and ask what the user wants to analyze). For off-topic questions, answer briefly in English, then steer back to gold trading. Never stay silent, never refuse to reply.

You are "Jenvu" — a gold (XAU/USD) trading analyst with 25+ years of institutional experience (prop desk, London/NY sessions). You have traded through 2008, 2013, 2020 and 2022-2025 gold cycles, and you speak from screen time, not textbooks.

Your method is ICT / Smart Money Concepts, applied strictly:
- Market structure: BOS, CHoCH, swing highs/lows, internal vs external liquidity.
- Liquidity: buy-side/sell-side liquidity pools, equal highs/lows, stop raids, liquidity sweeps before reversal.
- PD arrays: order blocks (OB), breaker blocks, fair value gaps (FVG/imbalance), mitigation blocks, premium vs discount of the dealing range (50% equilibrium).
- Time: Asian range, London open killzone, New York open killzone, judas swing, silver bullet window, daily/weekly opening gaps.
- Confluence with classic tools: EMA 20/50/200, RSI, ATR for stop sizing, session highs/lows, round numbers.
 - Risk first: define your stop before entry, size by ATR, never chase.

DATA RULE: Every message gives you a live JSON block with real XAU/USD spot, EMAs, RSI, ATR, support/resistance clusters, an "smc" object containing market structure (BOS/CHoCH, last swing high/low), dealingRange (premium/discount/equilibrium), fairValueGaps, orderBlocks, buySideLiquidity, sellSideLiquidity, liquidity sweeps, RSI divergence, volume value area (POC/VAH/VAL), session ranges, prior-day high/low, volatility regime, the live session/killzone and a confluence score, plus a "higherTimeframes" object with a bias summary for each higher frame and an "alignment" verdict. Use those exact numbers — never invent a price, never round away from the data, never contradict the structure or zone the data reports. If a field is empty, say that array is empty rather than making one up.

TOP-DOWN RULE (only when the user asks for a signal, trade idea, entry or market read — never for greetings or educational/conceptual questions): Read higherTimeframes first and state the higher-frame bias before anything else. No setup is A+ unless higherTimeframes.alignment agrees with your direction. If the verdict is "conflicted" or "leaning ... not aligned", the best grade you may give is B, and if the entry-frame bias fights the higher frames you must say stand aside.

ACCURACY PROTOCOL (run this silently before every trading answer):
1. Read the higher-frame bias from trend + EMA 200 + smc.structure.bias.
2. Locate the liquidity that is most likely to be taken next (buy-side above, sell-side below).
3. Find the POI that sits in the correct half of the dealing range — longs from discount, shorts from premium. Never long premium or short discount just because momentum looks strong.
4. Require at least 3 of 5 confluence factors (smc.confluence) to agree with your direction. If bullish and bearish scores are within 1 of each other, the honest answer is "no A+ setup — stand aside", and you must say so instead of forcing a trade.
5. Size the stop from ATR (typically 1.0-1.5x ATR beyond the invalidation swing) and require a minimum 1:2 risk-reward. If the nearest logical target does not give 1:2, reject the setup.
6. Grade the setup A+, B or C and state the grade with a realistic confidence percentage. Never claim a 90%+ win rate — professional edge lives around 50-65% strike rate with asymmetric R. Say this plainly if the user expects guaranteed wins.
7. State exactly what would invalidate the idea, in price terms.

HONESTY RULE: You are judged on accuracy, not optimism. A skipped trade is a correct answer. Never soften a mixed market into a clean signal, and never give an entry without a stop.

 
BREVITY (very important): Be concise. Answer the question directly in as few words as possible. Simple questions get 2-4 short sentences total — never a long essay. Only a full trade setup gets the Trade Plan format; everything else stays short. Never repeat engine data back, never explain background theory unless asked.

WRITING STYLE (very important): Write exactly like a modern AI assistant (ChatGPT-quality). Use complete, grammatical English sentences — never note-style fragments, never dumped keywords, never broken half-lines.

Formatting rules:
1. Start with one short plain-language paragraph (1-2 sentences) that answers the user directly.
2. Only add headings when the answer truly needs structure (trade plan, multi-part analysis). A normal question = short prose, no headings.
3. Keep any paragraph under ~50 words; keep lists to 3-6 items.
4. Use numbered lists (1., 2., 3.) for steps, trade plans and execution sequences; use "-" bullets only for unordered facts such as levels or observations.
5. Bold key numbers and terms with **double asterisks** (entry, stop, targets).
6. Keep one blank line between every heading, paragraph and list.
7. Total length limit: casual questions ~60 words; chart/screen analysis ~150 words; full trade plan ~250 words. Never exceed these.

TRADE PLAN FORMAT (use whenever you give a setup):
## Trade Plan
1. **Bias:** direction and the reason in one sentence.
2. **Entry:** exact price or zone (name the PD array: OB, FVG or breaker).
3. **Stop Loss:** exact price and why it sits there (ATR-based, beyond the invalidation swing).
4. **Target 1 / Target 2:** exact prices, tied to the liquidity pools you expect to be taken.
5. **Risk-Reward:** the ratio (reject anything under 1:2).
6. **Setup Grade:** A+, B or C, with a realistic confidence percentage.
7. **Invalidation:** what would cancel the idea.

Greetings and simple questions get a short, friendly prose answer with no headings and no lists. Talk like a senior mentor — direct, no hype. For chart or screen reads, first describe what you actually see (pair, timeframe, structure, key levels) in a paragraph, then give the analysis. Never promise profits; end every trading analysis with a one-line risk note.`;


const BLUESMIND_URL = "https://api.bluesminds.com/v1/chat/completions";
const BLUESMIND_CHAT_MODEL = "openai/gpt-oss-20b";
const BLUESMIND_VISION_MODEL = "meta/llama-3.2-11b-vision-instruct";
const LOVABLE_AI_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const LOVABLE_AI_FALLBACK_MODEL = "google/gemini-3.8-flash";

function isAllowedOrigin(origin: string) {
  if (origin.startsWith("chrome-extension://")) return true;
  try {
    const h = new URL(origin).hostname;
    return h.endsWith(".lovable.app") || h === "localhost" || h === "127.0.0.1";
  } catch {
    return false;
  }
}

function corsHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  const allowedOrigin = isAllowedOrigin(origin) ? origin : "null";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function isAllowedRequest(request: Request) {
  const origin = request.headers.get("origin");
  // same-origin fetches from our own site may omit Origin
  if (!origin) return true;
  return isAllowedOrigin(origin);
}


function json(request: Request, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(request) },
  });
}

async function callAi(
  key: string,
  messages: unknown[],
  maxTokens: number,
  hasImage: boolean,
) {
  let model = hasImage ? BLUESMIND_VISION_MODEL : BLUESMIND_CHAT_MODEL;
  const send = async (timeoutMs: number) =>
    fetch(BLUESMIND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_completion_tokens: maxTokens,
        messages,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

  const sendFallback = async () => {
    const fallbackKey = process.env["LOVABLE_API_KEY"];
    if (!fallbackKey) return null;
    model = LOVABLE_AI_FALLBACK_MODEL;
    return fetch(LOVABLE_AI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": fallbackKey,
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
    });
  };

  let res: Response;
  try {
    // Keep the user-facing request fast: a failed provider call goes straight
    // to the fallback instead of making the user wait through a second call.
    res = await send(hasImage ? 60_000 : 25_000);
  } catch {
    const fallback = await sendFallback().catch(() => null);
    if (!fallback) {
      return { error: "The analyst is busy right now — please try again in a moment.", status: 504 };
    }
    res = fallback;
  }
  if (res.status >= 500) {
    const fallback = await sendFallback().catch(() => null);
    if (fallback) res = fallback;
  }


  if (!res.ok) {
    const failure = (await res.json().catch(() => null)) as
      | { error?: { message?: string } | string; message?: string }
      | null;
    const providerMessage =
      typeof failure?.error === "string"
        ? failure.error
        : failure?.error?.message ?? failure?.message;
    const message = providerMessage?.slice(0, 300);
    if (res.status === 429) {
      return { error: message ?? "BluesMind rate limit — please try again shortly.", status: 429 };
    }
    if (res.status === 402) {
      return { error: message ?? "BluesMind credits exhausted.", status: 402 };
    }
    if (res.status === 401 || res.status === 403) {
      return { error: message ?? "BluesMind API key or access is not valid.", status: res.status };
    }
    return { error: message ?? `BluesMind request failed [${res.status}]`, status: res.status };
  }
  const out = (await res.json()) as {
    choices?: {
      message?: { content?: string; reasoning_content?: string; reasoning?: string };
      finish_reason?: string;
    }[];
  };
  const msg = out.choices?.[0]?.message;
  const text = (msg?.content || msg?.reasoning_content || msg?.reasoning || "").trim();
  if (!text) {
    console.error("Empty AI completion", JSON.stringify(out).slice(0, 800));
    return {
      error: "The analyst returned an empty response — please try again.",
      status: 502,
    };
  }
  return { text, model };
}

const REVIEWER_SYSTEM = `You are the senior desk reviewer: 25+ years institutional experience in ICT / Smart Money Concepts. A junior analyst has produced a draft read of XAU/USD. You also receive the desk engine output (market structure, premium/discount, FVGs, order blocks, liquidity pools and sweeps, RSI divergence, volume POC/VAH/VAL, session ranges, prior-day high/low, ATR and volatility regime, confluence score, higher-timeframe bias).

Your job:
1. Verify every number and level in the draft against the engine data. Silently correct anything that does not match; never invent levels.
2. Check top-down alignment. If the entry-frame idea fights the higher-timeframe bias, downgrade the grade or change the call to stand aside.
3. Check risk: stop distance must respect ATR, and risk-reward must be at least 1:2 or the setup is not tradable.
4. Remove hype, hedging and filler. Keep the structure the desk uses: a short opening paragraph, Title Case headings, full sentences, and a numbered trade plan (Bias, Entry, Stop Loss, Targets, Risk-Reward, Setup Grade, Invalidation) with key numbers in bold.

Output ONLY the final corrected answer for the user. Do not mention the draft, the review, yourself, or that any correction happened. If the draft is just a greeting or a short casual reply, return it as-is.`;

const TRADE_INTENT =
  /(trade|plan|entry|buy|sell|setup|signal|scalp|target|stop loss|stop-loss|analy|read (the |my )?(chart|screen|market)|what('| i)s the market|market (now|today|update)|current price|long|short)\b/i;

type SignalDirection = "buy" | "sell" | "stand-aside";
type Technicals = ReturnType<typeof import("@/lib/market.server")["computeTechnicals"]>;

function getValidEntryZones(technicals: Technicals, direction: SignalDirection) {
  if (direction === "stand-aside") return [];
  const wantedType = direction === "buy" ? "bullish" : "bearish";
  const equilibrium = technicals.smc.dealingRange.equilibrium;
  const price = technicals.price;
  return [...technicals.smc.orderBlocks, ...technicals.smc.fairValueGaps].filter((zone) => {
    const midpoint = (zone.from + zone.to) / 2;
    return (
      zone.type === wantedType &&
      (direction === "buy"
        ? midpoint <= equilibrium && zone.from <= price
        : midpoint >= equilibrium && zone.to >= price)
    );
  });
}

function getEngineDirection(
  technicals: Technicals,
  higherTimeframes: Awaited<ReturnType<typeof import("@/lib/market.server")["fetchHtfSummaries"]>> | null,
): SignalDirection {
  const confluence = technicals.smc.confluence;
  const lead = Math.abs(confluence.bullish - confluence.bearish);
  const localDirection = confluence.netBias;
  const alignment = higherTimeframes?.alignment;

  // A directional call needs a clear local edge and a higher-timeframe
  // majority in the same direction. Anything ambiguous fails closed.
  if (lead < 2 || localDirection === "neutral" || !alignment || alignment.totalFrames < 2) {
    return "stand-aside";
  }
  let direction: SignalDirection = "stand-aside";
  if (
    localDirection === "bullish" &&
    alignment.bullishFrames > alignment.bearishFrames
  ) {
    direction = "buy";
  }
  if (
    localDirection === "bearish" &&
    alignment.bearishFrames > alignment.bullishFrames
  ) {
    direction = "sell";
  }
  // A signal without a directionally correct OB/FVG in the correct half of
  // the dealing range has no defensible entry and must not be published.
  return getValidEntryZones(technicals, direction).length > 0 ? direction : "stand-aside";
}

function detectDraftDirection(text: string): Exclude<SignalDirection, "stand-aside"> | null {
  const buy = /(?:\*\*)?(?:bias|signal|direction)(?:\*\*)?\s*:\s*(?:\*\*)?(?:buy|long|bullish)\b/i.test(text);
  const sell = /(?:\*\*)?(?:bias|signal|direction)(?:\*\*)?\s*:\s*(?:\*\*)?(?:sell|short|bearish)\b/i.test(text);
  if (buy === sell) return null;
  return buy ? "buy" : "sell";
}

function enforceEngineDirection(
  text: string,
  direction: SignalDirection,
  isTradeRequest: boolean,
  technicals: Technicals | null,
): string {
  if (!isTradeRequest) return text;
  const draftDirection = detectDraftDirection(text);
  if (direction !== "stand-aside" && draftDirection === direction && technicals) {
    const entryLine = text.match(/(?:\*\*)?Entry(?:\*\*)?\s*:\s*([^\n]+)/i)?.[1] ?? "";
    const quotedEntries = [...entryLine.matchAll(/\b\d{3,5}(?:\.\d+)?\b/g)].map((match) => Number(match[0]));
    const tolerance = technicals.atr14 * 0.15;
    const validEntry = getValidEntryZones(technicals, direction).some((zone) =>
      quotedEntries.some((entry) => entry >= zone.from - tolerance && entry <= zone.to + tolerance),
    );
    if (validEntry) return text;
  }
  if (direction === "stand-aside" && !draftDirection) return text;

  return `The ICT/SMC engine does not confirm a safe directional setup right now, so the correct decision is to stand aside rather than force a trade.

## Trade Plan

1. **Bias:** Stand aside; local and higher-timeframe evidence is not sufficiently aligned.
2. **Entry:** No entry is valid until market structure, dealing-range location and higher-timeframe direction agree.
3. **Stop Loss:** Not applicable because there is no confirmed entry.
4. **Target 1 / Target 2:** Not applicable until a valid setup forms.
5. **Risk-Reward:** No trade; capital preservation takes priority.
6. **Setup Grade:** **C — low confidence**.
7. **Invalidation:** Reassess only after fresh structure and liquidity confirmation.

Risk note: skipping a conflicting signal is safer than taking the wrong side.`;
}

function shouldReview(
  draft: string,
  question: string | undefined,
  hasImage: boolean,
): boolean {
  // The second pass doubles latency, so it only runs where accuracy matters
  // most: when a chart/screen image is attached (vision drafts need a
  // text-model check). Text-only answers are already engine-verified.
  if (!hasImage) return false;
  if (draft.length < 400) return false;
  if (question && question.length < 80 && !TRADE_INTENT.test(question)) return false;
  return true;
}

async function seniorReview(
  key: string,
  context: string,
  draft: string,
  question: string | undefined,
) {
  // Trim the engine context for the reviewer — key numbers are enough to
  // verify the draft, and a shorter prompt keeps the second pass fast.
  const trimmedContext =
    context.length > 2600 ? context.slice(0, 2600) + "\n..." : context;
  const review = await callAi(
    key,
    [
      { role: "system", content: REVIEWER_SYSTEM },
      {
        role: "user",
        content:
          `Desk engine data (ICT/SMC):\n${trimmedContext}\n\n` +
          (question ? `User asked: ${question}\n\n` : "") +
          `Junior analyst draft:\n${draft}`,
      },
    ],
    1100,
    false,
  );
  if ("error" in review) return draft;
  return review.text;
}

export const Route = createFileRoute("/api/public/gold")({
  server: {
    handlers: {
      OPTIONS: async ({ request }) => {
        if (!isAllowedRequest(request)) return new Response(null, { status: 403 });
        return new Response(null, { status: 204, headers: corsHeaders(request) });
      },
      POST: async ({ request }) => {
        if (!isAllowedRequest(request)) {
          return json(request, { error: "Only the Jenvu Chrome extension can use this endpoint." }, 403);
        }
        let body: z.infer<typeof Body>;
        try {
          body = Body.parse(await request.json());
        } catch {
          return json(request, { error: "Invalid request" }, 400);
        }

        const tradeIntent = TRADE_INTENT.test(body.question ?? "");
        const needsMarketData =
          body.action !== "chat" || tradeIntent || Boolean(body.screenImage || body.chartImage);

        let market: {
          ticker: { price: number; changePercent: number; high: number; low: number; volume: number };
          technicals: ReturnType<typeof import("@/lib/market.server")["computeTechnicals"]>;
          chart: { t: number; c: number }[];
        } | null = null;
        let htf: Awaited<ReturnType<typeof import("@/lib/market.server")["fetchHtfSummaries"]>> | null =
          null;
        try {
          if (!needsMarketData) throw new Error("SKIP_MARKET_FOR_CASUAL_CHAT");
          const { fetchGoldMarket, computeTechnicals, fetchHtfSummaries } = await import(
            "@/lib/market.server"
          );
          const { candles, ticker, offset } = await fetchGoldMarket(body.timeframe, 300);
          market = {
            ticker,
            technicals: computeTechnicals(candles),
            chart: candles.slice(-80).map((c) => ({ t: c.time, c: Number(c.close.toFixed(2)) })),
          };
          if (body.action !== "snapshot") {
            const higher = ["1h", "4h", "1d"].filter((tf) => tf !== body.timeframe);
            htf = await fetchHtfSummaries(offset ?? 0, higher);
          }
        } catch (error) {
          if (needsMarketData) console.error("Gold market data request failed", error);
          if (body.action === "snapshot") {
            return json(
              request,
              { error: "Live gold data is temporarily unavailable. Please try again shortly." },
              503,
            );
          }
        }
        const ticker = market?.ticker ?? null;
        const technicals = market?.technicals ?? null;

        if (body.action === "snapshot") {
          return json(request, { ticker, technicals, chart: market?.chart ?? [], timeframe: body.timeframe });
        }


        const key = process.env["BLUESMIND_API_KEY"];
        if (!key) return json(request, { error: "BluesMind AI is not configured" }, 500);

        const engineDirection = technicals
          ? getEngineDirection(technicals, htf)
          : "stand-aside";
        const context = market
          ? JSON.stringify({
              ticker,
              technicals,
              higherTimeframes: htf,
              timeframe: body.timeframe,
              authoritativeSignalDirection: engineDirection,
            })
          : "Live market data is temporarily unavailable. Answer the user's message normally, and do not invent a current price or live levels.";

         if (body.action === "chat") {
           const chatContext =
             !tradeIntent && market
               ? JSON.stringify({ ticker, technicals, timeframe: body.timeframe })
               : context;
           const parts: unknown[] = [
             {
               type: "text",
               text:
                 `Live gold data (XAU/USD spot, timeframe ${body.timeframe}):\n${chatContext}\n\n` +
                 (tradeIntent
                   ? ""
                   : "This is a general/educational question — answer it briefly and directly. Do NOT give a trade plan, signal, stand-aside verdict or any market-direction call unless the user asked for one.\n\n") +
                (body.screenImage || body.chartImage
                  ? "The image below is the user's screen/chart right now — read the chart and levels visible on it and answer from what you actually see. Never say you cannot see the screen.\n\n"
                  : "No screen image is attached. If the user asks you to read their screen, tell them to press 'Share screen' first instead of guessing.\n\n") +

                `User: ${body.question ?? "Read the screen and tell me what to do next."}`,
            },
          ];
          const shot = body.screenImage ?? body.chartImage;
          if (shot) parts.push({ type: "image_url", image_url: { url: shot } });

          const history = (body.history ?? []).map((m) => ({
            role: m.role,
            content: m.text,
          }));

           const result = await callAi(
            key,
            [
              { role: "system", content: EXPERT_SYSTEM },
              ...history,
              { role: "user", content: parts },
            ],
             tradeIntent || shot ? 1300 : 320,
            Boolean(shot),
          );
          if ("error" in result) return json(request, { error: result.error }, result.status);
          const reviewed =
            market && shouldReview(result.text, body.question, Boolean(shot))
              ? await seniorReview(key, context, result.text, body.question)
              : result.text;
          const finalText = enforceEngineDirection(
            reviewed,
            engineDirection,
            TRADE_INTENT.test(body.question ?? ""),
            technicals,
          );
          return json(request, { text: finalText, ticker, technicals, model: result.model });
        }

        const mode = body.mode ?? "technical";
        const userContent: unknown[] = [
          {
            type: "text",
            text:
              `${MODE_PROMPT[mode]}\n\nLive gold (XAU/USD spot) data:\n${context}` +
              (body.question ? `\n\nUser question: ${body.question}` : "") +
              (body.chartImage ? "\n\nAlso read the attached chart screenshot." : ""),
          },
        ];
        if (body.chartImage) {
          userContent.push({ type: "image_url", image_url: { url: body.chartImage } });
        }

        const result = await callAi(
          key,
          [
            { role: "system", content: EXPERT_SYSTEM },
            { role: "user", content: userContent },
          ],
          1200,
          Boolean(body.chartImage),
        );
        if ("error" in result) return json(request, { error: result.error }, result.status);
        const finalText =
          market &&
          shouldReview(result.text, body.question, Boolean(body.chartImage))
            ? await seniorReview(key, context, result.text, body.question)
            : result.text;
        const guardedText = enforceEngineDirection(finalText, engineDirection, true, technicals);
        return json(request, { text: guardedText, ticker, technicals, model: result.model });
      },
    },
  },
});
