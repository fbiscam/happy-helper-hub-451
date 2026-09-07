export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const MARKET_APIS = [
  "https://data-api.binance.vision/api/v3",
  "https://api1.binance.com/api/v3",
  "https://api-gcp.binance.com/api/v3",
  "https://api.binance.com/api/v3",
];
export const GOLD_SYMBOL = "PAXGUSDT";

async function fetchMarket(path: string) {
  let lastStatus = 503;
  for (const base of MARKET_APIS) {
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { Accept: "application/json" },
      });
      if (res.ok) return res;
      lastStatus = res.status;
    } catch {
      // Try the next public market-data host.
    }
  }
  throw new Error(`Market data is temporarily unavailable [${lastStatus}]`);
}

export async function fetchCandles(interval: string, limit = 200): Promise<Candle[]> {
  const res = await fetchMarket(
    `/klines?symbol=${GOLD_SYMBOL}&interval=${interval}&limit=${limit}`,
  );
  const raw = (await res.json()) as unknown[][];
  return raw.map((k) => ({
    time: Number(k[0]),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  }));
}

export async function fetchTicker() {
  const res = await fetchMarket(`/ticker/24hr?symbol=${GOLD_SYMBOL}`);
  const t = (await res.json()) as Record<string, string>;
  return {
    price: Number(t['lastPrice']),
    changePercent: Number(t['priceChangePercent']),
    high: Number(t['highPrice']),
    low: Number(t['lowPrice']),
    volume: Number(t['volume']),
  };
}

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0]!;
  values.forEach((v, i) => {
    prev = i === 0 ? v : v * k + prev * (1 - k);
    out.push(prev);
  });
  return out;
}

function rsi(closes: number[], period = 14): number {
  let gain = 0;
  let loss = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i]! - closes[i - 1]!;
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  if (loss === 0) return 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

function atr(candles: Candle[], period = 14): number {
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    const p = candles[i - 1]!;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function pivots(candles: Candle[], span = 3) {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = span; i < candles.length - span; i++) {
    const win = candles.slice(i - span, i + span + 1);
    const c = candles[i]!;
    if (Math.max(...win.map((w) => w.high)) === c.high) highs.push(c.high);
    if (Math.min(...win.map((w) => w.low)) === c.low) lows.push(c.low);
  }
  return { highs, lows };
}

function cluster(levels: number[], price: number, tolerance: number, take = 3) {
  const sorted = [...levels].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const lvl of sorted) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(lvl - last[last.length - 1]!) <= tolerance) last.push(lvl);
    else groups.push([lvl]);
  }
  return groups
    .map((g) => ({
      level: g.reduce((a, b) => a + b, 0) / g.length,
      strength: g.length,
    }))
    .sort((a, b) => Math.abs(a.level - price) - Math.abs(b.level - price))
    .slice(0, take)
    .map((g) => ({ level: Number(g.level.toFixed(2)), strength: g.strength }));
}

export type Technicals = ReturnType<typeof computeTechnicals>;

type Swing = { price: number; index: number; kind: "high" | "low" };

/** Swing points used for market structure (BOS / CHoCH). */
function swings(candles: Candle[], span = 3): Swing[] {
  const out: Swing[] = [];
  for (let i = span; i < candles.length - span; i++) {
    const win = candles.slice(i - span, i + span + 1);
    const c = candles[i]!;
    if (Math.max(...win.map((w) => w.high)) === c.high) out.push({ price: c.high, index: i, kind: "high" });
    if (Math.min(...win.map((w) => w.low)) === c.low) out.push({ price: c.low, index: i, kind: "low" });
  }
  return out;
}

/** Last structural event: break of structure or change of character. */
function structure(candles: Candle[], sw: Swing[]) {
  const highs = sw.filter((s) => s.kind === "high").slice(-4);
  const lows = sw.filter((s) => s.kind === "low").slice(-4);
  const price = candles[candles.length - 1]!.close;
  const lastHigh = highs[highs.length - 1];
  const lastLow = lows[lows.length - 1];
  const higherHighs = highs.length >= 2 && highs[highs.length - 1]!.price > highs[highs.length - 2]!.price;
  const higherLows = lows.length >= 2 && lows[lows.length - 1]!.price > lows[lows.length - 2]!.price;
  const bias = higherHighs && higherLows ? "bullish" : !higherHighs && !higherLows ? "bearish" : "mixed";
  let event = "none";
  if (lastHigh && price > lastHigh.price) event = bias === "bearish" ? "bullish CHoCH" : "bullish BOS";
  else if (lastLow && price < lastLow.price) event = bias === "bullish" ? "bearish CHoCH" : "bearish BOS";
  return {
    bias,
    event,
    lastSwingHigh: lastHigh ? Number(lastHigh.price.toFixed(2)) : null,
    lastSwingLow: lastLow ? Number(lastLow.price.toFixed(2)) : null,
  };
}

/** Unmitigated 3-candle fair value gaps (imbalances) nearest to price. */
function fairValueGaps(candles: Candle[], price: number, take = 4) {
  const gaps: { type: "bullish" | "bearish"; from: number; to: number; mid: number }[] = [];
  for (let i = 2; i < candles.length; i++) {
    const a = candles[i - 2]!;
    const c = candles[i]!;
    if (c.low > a.high) gaps.push({ type: "bullish", from: a.high, to: c.low, mid: (a.high + c.low) / 2 });
    if (c.high < a.low) gaps.push({ type: "bearish", from: c.high, to: a.low, mid: (c.high + a.low) / 2 });
  }
  // keep gaps price has not fully traded back through
  const later = (g: { from: number; to: number }) => Math.abs(g.mid - price) > 0;
  return gaps
    .filter(later)
    .sort((x, y) => Math.abs(x.mid - price) - Math.abs(y.mid - price))
    .slice(0, take)
    .map((g) => ({
      type: g.type,
      from: Number(Math.min(g.from, g.to).toFixed(2)),
      to: Number(Math.max(g.from, g.to).toFixed(2)),
    }));
}

/** Last down/up candle before an impulsive move = order block. */
function orderBlocks(candles: Candle[], price: number, atrValue: number, take = 3) {
  const obs: { type: "bullish" | "bearish"; from: number; to: number }[] = [];
  for (let i = 1; i < candles.length - 2; i++) {
    const c = candles[i]!;
    const n1 = candles[i + 1]!;
    const n2 = candles[i + 2]!;
    const impulseUp = n1.close - c.close > atrValue && n2.close > n1.close;
    const impulseDown = c.close - n1.close > atrValue && n2.close < n1.close;
    if (c.close < c.open && impulseUp) obs.push({ type: "bullish", from: c.low, to: c.high });
    if (c.close > c.open && impulseDown) obs.push({ type: "bearish", from: c.low, to: c.high });
  }
  return obs
    .sort((x, y) => Math.abs((x.from + x.to) / 2 - price) - Math.abs((y.from + y.to) / 2 - price))
    .slice(0, take)
    .map((o) => ({ type: o.type, from: Number(o.from.toFixed(2)), to: Number(o.to.toFixed(2)) }));
}

/** Equal highs / lows = resting liquidity pools. */
function liquidity(sw: Swing[], tolerance: number) {
  const eq = (kind: "high" | "low") => {
    const pts = sw.filter((s) => s.kind === kind).map((s) => s.price);
    const pools: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        if (Math.abs(pts[i]! - pts[j]!) <= tolerance * 0.25) pools.push((pts[i]! + pts[j]!) / 2);
      }
    }
    return [...new Set(pools.map((p) => Number(p.toFixed(2))))].slice(-3);
  };
  return { buySideLiquidity: eq("high"), sellSideLiquidity: eq("low") };
}

/** Premium / discount inside the current dealing range. */
function dealingRange(candles: Candle[], price: number) {
  const range = candles.slice(-60);
  const high = Math.max(...range.map((c) => c.high));
  const low = Math.min(...range.map((c) => c.low));
  const eq = (high + low) / 2;
  const pct = ((price - low) / (high - low || 1)) * 100;
  return {
    rangeHigh: Number(high.toFixed(2)),
    rangeLow: Number(low.toFixed(2)),
    equilibrium: Number(eq.toFixed(2)),
    positionPct: Number(pct.toFixed(1)),
    zone: pct > 55 ? "premium" : pct < 45 ? "discount" : "equilibrium",
  };
}

/** Which ICT killzone / session is live right now (UTC). */
function session() {
  const h = new Date().getUTCHours();
  if (h >= 0 && h < 6) return "Asian range";
  if (h >= 6 && h < 9) return "Pre-London";
  if (h >= 9 && h < 11) return "London killzone";
  if (h >= 11 && h < 13) return "London/NY overlap";
  if (h >= 13 && h < 16) return "New York killzone";
  return "Late NY / close";
}

export function computeTechnicals(candles: Candle[]) {
  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1]!;
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const a = atr(candles);
  const { highs, lows } = pivots(candles);
  const last20 = candles.slice(-20);
  const sw = swings(candles);

  const e20 = ema20[ema20.length - 1]!;
  const e50 = ema50[ema50.length - 1]!;
  const e200 = ema200[ema200.length - 1]!;

  const trend =
    price > e20 && e20 > e50 ? "uptrend" : price < e20 && e20 < e50 ? "downtrend" : "range";

  const struct = structure(candles, sw);
  const range = dealingRange(candles, price);

  // Simple confluence score so the model can grade setup quality honestly.
  const bullFactors = [
    trend === "uptrend",
    price > e200,
    struct.bias === "bullish",
    range.zone === "discount",
    Number(rsi(closes).toFixed(1)) > 50,
  ].filter(Boolean).length;
  const bearFactors = [
    trend === "downtrend",
    price < e200,
    struct.bias === "bearish",
    range.zone === "premium",
    Number(rsi(closes).toFixed(1)) < 50,
  ].filter(Boolean).length;

  return {
    price: Number(price.toFixed(2)),
    ema20: Number(e20.toFixed(2)),
    ema50: Number(e50.toFixed(2)),
    ema200: Number(e200.toFixed(2)),
    rsi14: Number(rsi(closes).toFixed(1)),
    atr14: Number(a.toFixed(2)),
    trend,
    recentHigh: Number(Math.max(...last20.map((c) => c.high)).toFixed(2)),
    recentLow: Number(Math.min(...last20.map((c) => c.low)).toFixed(2)),
    resistance: cluster(
      highs.filter((h) => h >= price),
      price,
      a,
    ),
    support: cluster(
      lows.filter((l) => l <= price),
      price,
      a,
    ),
    smc: {
      structure: struct,
      dealingRange: range,
      fairValueGaps: fairValueGaps(candles, price),
      orderBlocks: orderBlocks(candles, price, a),
      ...liquidity(sw, a),
      session: session(),
      confluence: {
        bullish: bullFactors,
        bearish: bearFactors,
        max: 5,
        netBias: bullFactors > bearFactors ? "bullish" : bearFactors > bullFactors ? "bearish" : "neutral",
      },
    },
    closes: closes.slice(-60).map((c) => Number(c.toFixed(2))),
  };
}


/** Live XAU/USD spot price (troy ounce, USD). */
export async function fetchSpotPrice(): Promise<number | null> {
  try {
    const res = await fetch("https://api.gold-api.com/price/XAU", {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { price?: number };
    const price = Number(data?.price);
    return Number.isFinite(price) && price > 0 ? price : null;
  } catch {
    return null;
  }
}

/**
 * Candles come from PAXG/USDT (intraday OHLC), but the headline price must be
 * real XAU/USD spot. We shift the candle series by the spot-vs-PAXG offset so
 * every level the panel and the AI quote matches real gold pricing.
 */
export async function fetchGoldMarket(interval: string, limit = 300) {
  const [candles, ticker, spot] = await Promise.all([
    fetchCandles(interval, limit),
    fetchTicker(),
    fetchSpotPrice(),
  ]);
  const last = candles[candles.length - 1]?.close ?? ticker.price;
  if (spot === null || !Number.isFinite(last)) return { candles, ticker, spot: null };
  const offset = spot - last;
  const shifted = candles.map((c) => ({
    ...c,
    open: c.open + offset,
    high: c.high + offset,
    low: c.low + offset,
    close: c.close + offset,
  }));
  return {
    candles: shifted,
    ticker: {
      ...ticker,
      price: Number(spot.toFixed(2)),
      high: Number((ticker.high + offset).toFixed(2)),
      low: Number((ticker.low + offset).toFixed(2)),
    },
    spot,
  };
}
