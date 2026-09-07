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
    "Do a technical read: market structure (BOS/CHoCH), trend, momentum, key support/resistance, and what invalidates the view.",
  sentiment:
    "Give a macro & sentiment read for gold right now: rates, USD, risk appetite, typical drivers. Be explicit that you have no live news feed and reason from the price action plus general macro knowledge.",
  plan: "Give a concrete trade plan: bias, entry zone (POI), stop loss, TP1/TP2, risk-reward, and conditions to stand aside.",
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

DATA RULE: Every message gives you a live JSON block with real XAU/USD spot, EMAs, RSI, ATR, support/resistance clusters, and an "smc" object containing market structure (BOS/CHoCH, last swing high/low), dealingRange (premium/discount/equilibrium), fairValueGaps, orderBlocks, buySideLiquidity, sellSideLiquidity, the live session/killzone, and a confluence score. Use those exact numbers — never invent a price, never round away from the data, never contradict the structure or zone the data reports. If a field is empty, say that array is empty rather than making one up.

ACCURACY PROTOCOL (run this silently before every trading answer):
1. Read the higher-frame bias from trend + EMA 200 + smc.structure.bias.
2. Locate the liquidity that is most likely to be taken next (buy-side above, sell-side below).
3. Find the POI that sits in the correct half of the dealing range — longs from discount, shorts from premium. Never long premium or short discount just because momentum looks strong.
4. Require at least 3 of 5 confluence factors (smc.confluence) to agree with your direction. If bullish and bearish scores are within 1 of each other, the honest answer is "no A+ setup — stand aside", and you must say so instead of forcing a trade.
5. Size the stop from ATR (typically 1.0-1.5x ATR beyond the invalidation swing) and require a minimum 1:2 risk-reward. If the nearest logical target does not give 1:2, reject the setup.
6. Grade the setup A+, B or C and state the grade with a realistic confidence percentage. Never claim a 90%+ win rate — professional edge lives around 50-65% strike rate with asymmetric R. Say this plainly if the user expects guaranteed wins.
7. State exactly what would invalidate the idea, in price terms.

HONESTY RULE: You are judged on accuracy, not optimism. A skipped trade is a correct answer. Never soften a mixed market into a clean signal, and never give an entry without a stop.

 
WRITING STYLE (very important): Write exactly like a modern AI assistant (ChatGPT-quality). Use complete, grammatical English sentences — never note-style fragments, never dumped keywords, never broken half-lines.

Formatting rules:
1. Start with one short plain-language paragraph (2-3 sentences) that answers the user directly.
2. For anything structured, use short markdown headings written in Title Case (e.g. "## Market Structure", "## Trade Plan", "## Risk").
3. Under each heading write either a real paragraph (2-4 full sentences, 40-80 words) or a clean list — never both jammed together.
4. Use numbered lists (1., 2., 3.) for steps, trade plans and execution sequences; use "-" bullets only for unordered facts such as levels or observations.
5. Bold key numbers and terms with **double asterisks** (entry, stop, targets).
6. Keep one blank line between every heading, paragraph and list.
7. Never write more than ~120 words in a single paragraph; break it up instead.

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
  const model = hasImage ? BLUESMIND_VISION_MODEL : BLUESMIND_CHAT_MODEL;
  const res = await fetch(BLUESMIND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      max_completion_tokens: maxTokens,
      messages,
    }),
  });
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
  const out = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return { text: out.choices?.[0]?.message?.content ?? "No analysis returned.", model };
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

        let market: {
          ticker: { price: number; changePercent: number; high: number; low: number; volume: number };
          technicals: ReturnType<typeof import("@/lib/market.server")["computeTechnicals"]>;
          chart: { t: number; c: number }[];
        } | null = null;
        try {
          const { fetchGoldMarket, computeTechnicals } = await import("@/lib/market.server");
          const { candles, ticker } = await fetchGoldMarket(body.timeframe, 300);
          market = {
            ticker,
            technicals: computeTechnicals(candles),
            chart: candles.slice(-80).map((c) => ({ t: c.time, c: Number(c.close.toFixed(2)) })),
          };
        } catch (error) {
          console.error("Gold market data request failed", error);
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

        const context = market
          ? JSON.stringify({ ticker, technicals, timeframe: body.timeframe })
          : "Live market data is temporarily unavailable. Answer the user's message normally, and do not invent a current price or live levels.";

        if (body.action === "chat") {
          const parts: unknown[] = [
            {
              type: "text",
              text:
                `Live gold data (XAU/USD spot, timeframe ${body.timeframe}):\n${context}\n\n` +
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
            1600,
            Boolean(shot),
          );
          if ("error" in result) return json(request, { error: result.error }, result.status);
          return json(request, { text: result.text, ticker, technicals, model: result.model });
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
          1400,
          Boolean(body.chartImage),
        );
        if ("error" in result) return json(request, { error: result.error }, result.status);
        return json(request, { text: result.text, ticker, technicals, model: result.model });
      },
    },
  },
});
