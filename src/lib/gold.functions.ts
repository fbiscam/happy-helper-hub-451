import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const TF = z.enum(["15m", "1h", "4h", "1d"]);

export const getGoldSnapshot = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ timeframe: TF }).parse(input))
  .handler(async ({ data }) => {
    const { fetchCandles, fetchTicker, computeTechnicals } = await import("./market.server");
    const [candles, ticker] = await Promise.all([
      fetchCandles(data.timeframe, 300),
      fetchTicker(),
    ]);
    return {
      ticker,
      technicals: computeTechnicals(candles),
      timeframe: data.timeframe,
      updatedAt: new Date().toISOString(),
    };
  });

const AnalyzeInput = z.object({
  timeframe: TF,
  mode: z.enum(["technical", "sentiment", "plan"]),
  chartImage: z.string().max(6_000_000).optional(),
  question: z.string().max(1000).optional(),
});

const MODE_PROMPT: Record<string, string> = {
  technical:
    "Do a technical read: trend, momentum, key support/resistance, and what invalidates the view.",
  sentiment:
    "Give a macro & sentiment read for gold right now: rates, USD, risk appetite, typical drivers. Be explicit that you have no live news feed and reason from the price action plus general macro knowledge.",
  plan: "Give a concrete trade plan: bias, entry zone, stop loss, TP1/TP2, risk-reward, and conditions to stand aside.",
};

export const analyzeGold = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => AnalyzeInput.parse(input))
  .handler(async ({ data }) => {
    const key = process.env['LOVABLE_API_KEY'];
    if (!key) throw new Error("AI is not configured");

    const { fetchCandles, fetchTicker, computeTechnicals } = await import("./market.server");
    const [candles, ticker] = await Promise.all([
      fetchCandles(data.timeframe, 300),
      fetchTicker(),
    ]);
    const tech = computeTechnicals(candles);

    const context = JSON.stringify({ ticker, technicals: tech, timeframe: data.timeframe });

    const userContent: unknown[] = [
      {
        type: "text",
        text:
          `${MODE_PROMPT[data.mode]}\n\nLive gold (PAXG/USDT, tracks XAU/USD) data:\n${context}` +
          (data.question ? `\n\nUser question: ${data.question}` : "") +
          (data.chartImage ? "\n\nAlso read the attached chart screenshot." : ""),
      },
    ];
    if (data.chartImage) {
      userContent.push({ type: "image_url", image_url: { url: data.chartImage } });
    }

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({
        model: "openai/gpt-6-astra",
        reasoning_effort: "low",
        max_completion_tokens: 1400,
        messages: [
          {
            role: "system",
            content:
              "You are a disciplined gold (XAU/USD) trading analyst. Be concise and structured with short markdown headings and bullets. Always include concrete price levels. End with a one-line risk disclaimer. Never promise profits.",
          },
          { role: "user", content: userContent },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      if (res.status === 429) throw new Error("Too many requests — please wait a moment and try again.");
      if (res.status === 402) throw new Error("AI credits exhausted — add credits to your workspace.");
      throw new Error(`AI request failed [${res.status}]: ${body}`);
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return {
      text: json.choices?.[0]?.message?.content ?? "No analysis returned.",
      technicals: tech,
      ticker,
    };
  });
