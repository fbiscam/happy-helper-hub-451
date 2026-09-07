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

export function computeTechnicals(candles: Candle[]) {
  const closes = candles.map((c) => c.close);
  const price = closes[closes.length - 1]!;
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const a = atr(candles);
  const { highs, lows } = pivots(candles);
  const last20 = candles.slice(-20);

  const e20 = ema20[ema20.length - 1]!;
  const e50 = ema50[ema50.length - 1]!;
  const e200 = ema200[ema200.length - 1]!;

  const trend =
    price > e20 && e20 > e50 ? "uptrend" : price < e20 && e20 < e50 ? "downtrend" : "range";

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
    closes: closes.slice(-60).map((c) => Number(c.toFixed(2))),
  };
}
