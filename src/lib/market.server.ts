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

/**
 * Advanced market structure engine.
 * Walks swing points chronologically and records every close-confirmed
 * break of structure (BOS) and change of character (CHoCH), then derives the
 * protected high/low and the current inducement (IDM) level.
 */
function structure(candles: Candle[], sw: Swing[]) {
  const price = candles[candles.length - 1]!.close;
  const n = candles.length;
  const ordered = [...sw].sort((a, b) => a.index - b.index);

  type Ev = {
    type: "BOS" | "CHoCH";
    direction: "bullish" | "bearish";
    level: number;
    brokenAt: number;
    barsAgo: number;
  };
  const events: Ev[] = [];
  let trend: "bullish" | "bearish" | null = null;
  let lastBreakIdx = 0;

  for (const s of ordered) {
    // first candle after the swing formed that CLOSES beyond it = confirmed break
    let brokenAt = -1;
    for (let i = s.index + 3; i < n; i++) {
      const c = candles[i]!;
      if (s.kind === "high" && c.close > s.price) { brokenAt = i; break; }
      if (s.kind === "low" && c.close < s.price) { brokenAt = i; break; }
    }
    if (brokenAt < 0 || brokenAt <= lastBreakIdx) continue;
    const direction = s.kind === "high" ? "bullish" : "bearish";
    const type: "BOS" | "CHoCH" = trend && trend !== direction ? "CHoCH" : "BOS";
    events.push({
      type,
      direction,
      level: Number(s.price.toFixed(2)),
      brokenAt,
      barsAgo: n - 1 - brokenAt,
    });
    trend = direction;
    lastBreakIdx = brokenAt;
  }

  const last = events[events.length - 1] ?? null;
  const highs = ordered.filter((s) => s.kind === "high");
  const lows = ordered.filter((s) => s.kind === "low");
  const lastHigh = highs[highs.length - 1];
  const lastLow = lows[lows.length - 1];

  // Protected swing: the low that produced the last bullish break (or the high
  // that produced the last bearish break). Breaking it flips structure.
  let protectedHigh: number | null = null;
  let protectedLow: number | null = null;
  if (last) {
    const before = ordered.filter((s) => s.index < last.brokenAt);
    if (last.direction === "bullish") {
      const l = before.filter((s) => s.kind === "low").slice(-1)[0];
      protectedLow = l ? Number(l.price.toFixed(2)) : null;
    } else {
      const h = before.filter((s) => s.kind === "high").slice(-1)[0];
      protectedHigh = h ? Number(h.price.toFixed(2)) : null;
    }
  }

  // Inducement (IDM): the nearest minor liquidity pocket formed AFTER the last
  // break, which price usually sweeps before continuing with the trend.
  let inducement: { level: number; type: "sell-side" | "buy-side"; taken: boolean } | null = null;
  if (last) {
    const after = ordered.filter((s) => s.index > last.brokenAt);
    if (last.direction === "bullish") {
      const l = after.filter((s) => s.kind === "low").sort((a, b) => b.price - a.price)[0];
      if (l) {
        const taken = candles.slice(l.index + 1).some((c) => c.low < l.price);
        inducement = { level: Number(l.price.toFixed(2)), type: "sell-side", taken };
      }
    } else {
      const h = after.filter((s) => s.kind === "high").sort((a, b) => a.price - b.price)[0];
      if (h) {
        const taken = candles.slice(h.index + 1).some((c) => c.high > h.price);
        inducement = { level: Number(h.price.toFixed(2)), type: "buy-side", taken };
      }
    }
  }

  const recent = events.slice(-5).map((e) => ({
    type: e.type,
    direction: e.direction,
    level: e.level,
    barsAgo: e.barsAgo,
  }));
  const bias = trend ?? "mixed";

  return {
    bias,
    event: last ? `${last.direction} ${last.type}` : "none",
    lastEvent: last
      ? { type: last.type, direction: last.direction, level: last.level, barsAgo: last.barsAgo }
      : null,
    recentEvents: recent,
    lastBos: [...events].reverse().find((e) => e.type === "BOS")
      ? (() => {
          const b = [...events].reverse().find((e) => e.type === "BOS")!;
          return { direction: b.direction, level: b.level, barsAgo: b.barsAgo };
        })()
      : null,
    lastChoch: (() => {
      const c = [...events].reverse().find((e) => e.type === "CHoCH");
      return c ? { direction: c.direction, level: c.level, barsAgo: c.barsAgo } : null;
    })(),
    protectedHigh,
    protectedLow,
    inducement,
    nextBullishBreakLevel: lastHigh ? Number(lastHigh.price.toFixed(2)) : null,
    nextBearishBreakLevel: lastLow ? Number(lastLow.price.toFixed(2)) : null,
    distanceToBullishBreak: lastHigh ? Number((lastHigh.price - price).toFixed(2)) : null,
    distanceToBearishBreak: lastLow ? Number((price - lastLow.price).toFixed(2)) : null,
    lastSwingHigh: lastHigh ? Number(lastHigh.price.toFixed(2)) : null,
    lastSwingLow: lastLow ? Number(lastLow.price.toFixed(2)) : null,
  };
}

/** Last-candle price action reading: engulfing, rejection wicks, inside bars. */
function priceAction(candles: Candle[], atrValue: number) {
  const n = candles.length;
  const c = candles[n - 1]!;
  const p = candles[n - 2]!;
  const body = Math.abs(c.close - c.open);
  const upper = c.high - Math.max(c.close, c.open);
  const lower = Math.min(c.close, c.open) - c.low;
  const rangeSize = c.high - c.low || 1;
  const patterns: string[] = [];
  if (c.close > c.open && c.close > p.high && c.open < p.low) patterns.push("bullish engulfing");
  if (c.close < c.open && c.close < p.low && c.open > p.high) patterns.push("bearish engulfing");
  if (lower > body * 2 && lower / rangeSize > 0.5) patterns.push("bullish rejection wick");
  if (upper > body * 2 && upper / rangeSize > 0.5) patterns.push("bearish rejection wick");
  if (c.high < p.high && c.low > p.low) patterns.push("inside bar (compression)");
  if (body / rangeSize > 0.8) patterns.push(c.close > c.open ? "bullish marubozu" : "bearish marubozu");
  const last3 = candles.slice(-3);
  const momentum =
    last3.every((x) => x.close > x.open) ? "three bullish closes"
      : last3.every((x) => x.close < x.open) ? "three bearish closes"
        : "mixed";
  return {
    lastCandle: {
      open: Number(c.open.toFixed(2)),
      high: Number(c.high.toFixed(2)),
      low: Number(c.low.toFixed(2)),
      close: Number(c.close.toFixed(2)),
      bodyPctOfRange: Number(((body / rangeSize) * 100).toFixed(0)),
      direction: c.close > c.open ? "bullish" : "bearish",
      sizeVsAtr: Number((rangeSize / (atrValue || 1)).toFixed(2)),
    },
    patterns: patterns.length ? patterns : ["no clean pattern"],
    momentum,
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
  const later = (g: { mid: number }) => Math.abs(g.mid - price) > 0;
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

/** Recent stop raids: wick through a prior swing that closes back inside. */
function sweeps(candles: Candle[], sw: Swing[], atrValue: number) {
  const out: { type: "buy-side" | "sell-side"; level: number; barsAgo: number }[] = [];
  const n = candles.length;
  for (let i = Math.max(1, n - 30); i < n; i++) {
    const c = candles[i]!;
    for (const s of sw) {
      if (s.index >= i - 1) continue;
      if (s.kind === "high" && c.high > s.price && c.close < s.price && c.high - s.price < atrValue * 3)
        out.push({ type: "buy-side", level: Number(s.price.toFixed(2)), barsAgo: n - 1 - i });
      if (s.kind === "low" && c.low < s.price && c.close > s.price && s.price - c.low < atrValue * 3)
        out.push({ type: "sell-side", level: Number(s.price.toFixed(2)), barsAgo: n - 1 - i });
    }
  }
  return out.sort((a, b) => a.barsAgo - b.barsAgo).slice(0, 3);
}

/** RSI divergence against the last two swings in the same direction. */
function divergence(candles: Candle[]) {
  const closes = candles.map((c) => c.close);
  const rsiAt = (end: number) => rsi(closes.slice(0, end), 14);
  const n = candles.length;
  const a = n - 1;
  const b = n - 11;
  if (b < 30) return "none";
  const priceUp = closes[a]! > closes[b]!;
  const rsiUp = rsiAt(a) > rsiAt(b);
  if (priceUp && !rsiUp) return "bearish divergence";
  if (!priceUp && rsiUp) return "bullish divergence";
  return "none";
}

/** Volume-weighted value area: where most of the recent business was done. */
function valueArea(candles: Candle[]) {
  const window = candles.slice(-120);
  if (!window.length) return null;
  const high = Math.max(...window.map((c) => c.high));
  const low = Math.min(...window.map((c) => c.low));
  const buckets = 24;
  const step = (high - low) / buckets || 1;
  const vol = new Array(buckets).fill(0) as number[];
  for (const c of window) {
    const idx = Math.min(buckets - 1, Math.max(0, Math.floor((c.close - low) / step)));
    vol[idx] = vol[idx]! + (c.volume || 1);
  }
  const total = vol.reduce((x, y) => x + y, 0);
  const pocIdx = vol.indexOf(Math.max(...vol));
  let acc = vol[pocIdx]!;
  let lo = pocIdx;
  let hi = pocIdx;
  while (acc < total * 0.7 && (lo > 0 || hi < buckets - 1)) {
    const down = lo > 0 ? vol[lo - 1]! : -1;
    const up = hi < buckets - 1 ? vol[hi + 1]! : -1;
    if (up >= down) acc += vol[++hi]!;
    else acc += vol[--lo]!;
  }
  return {
    poc: Number((low + (pocIdx + 0.5) * step).toFixed(2)),
    valueAreaHigh: Number((low + (hi + 1) * step).toFixed(2)),
    valueAreaLow: Number((low + lo * step).toFixed(2)),
  };
}

/** Today's Asian / London / NY ranges plus the prior day high-low. */
function sessionRanges(candles: Candle[]) {
  const now = new Date();
  const dayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const inWindow = (t: number, from: number, to: number) => {
    const h = new Date(t).getUTCHours();
    return t >= dayStart && h >= from && h < to;
  };
  const range = (from: number, to: number) => {
    const sel = candles.filter((c) => inWindow(c.time, from, to));
    if (!sel.length) return null;
    return {
      high: Number(Math.max(...sel.map((c) => c.high)).toFixed(2)),
      low: Number(Math.min(...sel.map((c) => c.low)).toFixed(2)),
    };
  };
  const prior = candles.filter((c) => c.time < dayStart && c.time >= dayStart - 86400000);
  return {
    asian: range(0, 7),
    london: range(7, 12),
    newYork: range(12, 17),
    priorDay: prior.length
      ? {
          high: Number(Math.max(...prior.map((c) => c.high)).toFixed(2)),
          low: Number(Math.min(...prior.map((c) => c.low)).toFixed(2)),
        }
      : null,
  };
}

/** Realised volatility regime — tells the model whether to expect expansion. */
function volatility(candles: Candle[], atrValue: number) {
  const older = atr(candles.slice(0, -20), 14);
  const ratio = older > 0 ? atrValue / older : 1;
  return {
    atrNow: Number(atrValue.toFixed(2)),
    atrPrior: Number(older.toFixed(2)),
    regime: ratio > 1.25 ? "expanding" : ratio < 0.8 ? "compressing" : "stable",
    suggestedStopDistance: Number((atrValue * 1.3).toFixed(2)),
  };
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
      recentSweeps: sweeps(candles, sw, a),
      divergence: divergence(candles),
      valueArea: valueArea(candles),
      sessionRanges: sessionRanges(candles),
      volatility: volatility(candles, a),
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
  if (spot === null || !Number.isFinite(last)) return { candles, ticker, spot: null, offset: 0 };
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
    offset,
  };
}

/**
 * Higher-timeframe context. Real desks never trade a 15m chart blind — this
 * returns a compact bias summary for each higher frame so the analyst can
 * demand top-down alignment before calling a setup valid.
 */
export async function fetchHtfSummaries(offset: number, timeframes: string[]) {
  const results = await Promise.all(
    timeframes.map(async (tf) => {
      try {
        const raw = await fetchCandles(tf, 300);
        const shifted = raw.map((c) => ({
          ...c,
          open: c.open + offset,
          high: c.high + offset,
          low: c.low + offset,
          close: c.close + offset,
        }));
        const t = computeTechnicals(shifted);
        return {
          timeframe: tf,
          trend: t.trend,
          structureBias: t.smc.structure.bias,
          structureEvent: t.smc.structure.event,
          zone: t.smc.dealingRange.zone,
          rangeHigh: t.smc.dealingRange.rangeHigh,
          rangeLow: t.smc.dealingRange.rangeLow,
          ema200: t.ema200,
          rsi14: t.rsi14,
          netBias: t.smc.confluence.netBias,
          nearestFvg: t.smc.fairValueGaps[0] ?? null,
          nearestOrderBlock: t.smc.orderBlocks[0] ?? null,
        };
      } catch {
        return null;
      }
    }),
  );
  const frames = results.filter((r): r is NonNullable<typeof r> => r !== null);
  const votes = frames.map((f) => f.netBias);
  const bull = votes.filter((v) => v === "bullish").length;
  const bear = votes.filter((v) => v === "bearish").length;
  return {
    frames,
    alignment: {
      bullishFrames: bull,
      bearishFrames: bear,
      totalFrames: frames.length,
      verdict:
        bull === frames.length && frames.length > 0
          ? "fully aligned bullish"
          : bear === frames.length && frames.length > 0
            ? "fully aligned bearish"
            : bull > bear
              ? "leaning bullish, not aligned"
              : bear > bull
                ? "leaning bearish, not aligned"
                : "conflicted",
    },
  };
}
