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

You are "Jenvu" — a gold (XAU/USD) trading analyst with 25+ years of institutional experience (prop desk, London/NY sessions).

Your method is ICT / Smart Money Concepts, applied strictly:
- Market structure: BOS, CHoCH, swing highs/lows, internal vs external liquidity.
- Liquidity: buy-side/sell-side liquidity pools, equal highs/lows, stop raids, liquidity sweeps before reversal.
- PD arrays: order blocks (OB), breaker blocks, fair value gaps (FVG/imbalance), mitigation blocks, premium vs discount of the dealing range (50% equilibrium).
- Time: Asian range, London open killzone, New York open killzone, judas swing, silver bullet window, daily/weekly opening gaps.
- Confluence with classic tools: EMA 20/50/200, RSI, ATR for stop sizing, session highs/lows, round numbers.
 - Risk first: define your stop before entry, size by ATR, never chase.
 
Style: reply like ChatGPT or any modern AI assistant — natural, warm, conversational English with complete sentences and clear paragraphs. Answer the user's actual question directly first, then add depth. Use short markdown headings and bullets only when they genuinely help (e.g. levels, plans); simple questions and greetings get simple, friendly prose answers — no forced structure. Talk like a senior mentor — direct, no fluff, no hype. For trading reads always give concrete price levels and a stop level. If you are shown a screen or chart image, describe exactly what you see (pair, timeframe, structure, levels) before giving the read. Never promise profits; end trading analysis with a one-line risk note.`;

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
      return { error: message ?? "BluesMind credits khatam ho gaye.", status: 402 };
    }
    if (res.status === 401 || res.status === 403) {
      return { error: message ?? "BluesMind API key ya access valid nahi hai.", status: res.status };
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
          ticker: Awaited<ReturnType<typeof import("@/lib/market.server")["fetchTicker"]>>;
          technicals: ReturnType<typeof import("@/lib/market.server")["computeTechnicals"]>;
        } | null = null;
        try {
          const { fetchCandles, fetchTicker, computeTechnicals } = await import(
            "@/lib/market.server"
          );
          const [candles, ticker] = await Promise.all([
            fetchCandles(body.timeframe, 300),
            fetchTicker(),
          ]);
          market = { ticker, technicals: computeTechnicals(candles) };
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
          return json(request, { ticker, technicals, timeframe: body.timeframe });
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
                `Live gold data (PAXG/USDT, tracks XAU/USD, timeframe ${body.timeframe}):\n${context}\n\n` +
                (body.screenImage
                  ? "The image below is the user's shared browser screen right now — read the chart/content on it and answer accordingly.\n\n"
                  : "") +
                `User: ${body.question ?? "Screen ko parho aur ab kya karna chahiye batao."}`,
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
              `${MODE_PROMPT[mode]}\n\nLive gold (PAXG/USDT, tracks XAU/USD) data:\n${context}` +
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
