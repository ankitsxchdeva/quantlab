import type { Bar } from "../types";
import type { Indicator, PriceSource } from "./schema";

export type Series = (number | null)[];

export function priceSeries(bars: Bar[], source: PriceSource): number[] {
  switch (source) {
    case "open":
      return bars.map((b) => b.open);
    case "high":
      return bars.map((b) => b.high);
    case "low":
      return bars.map((b) => b.low);
    case "close":
      return bars.map((b) => b.close);
    case "volume":
      return bars.map((b) => b.volume);
    case "hl2":
      return bars.map((b) => (b.high + b.low) / 2);
    case "hlc3":
      return bars.map((b) => (b.high + b.low + b.close) / 3);
    case "ohlc4":
      return bars.map((b) => (b.open + b.high + b.low + b.close) / 4);
    default: {
      const _exhaustive: never = source;
      throw new Error(`Unknown price source: ${String(_exhaustive)}`);
    }
  }
}

export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0 || values.length === 0) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      seed += values[i];
      continue;
    }
    if (i === period - 1) {
      seed += values[i];
      out[i] = seed / period;
    } else {
      const prev = out[i - 1] as number;
      out[i] = values[i] * k + prev * (1 - k);
    }
  }
  return out;
}

export function rsi(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length < period + 1 || period <= 0) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = values[i] - values[i - 1];
    if (ch >= 0) avgGain += ch;
    else avgLoss -= ch;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const ch = values[i] - values[i - 1];
    const gain = ch > 0 ? ch : 0;
    const loss = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export interface MacdResult {
  macd: Series;
  signal: Series;
  hist: Series;
}

export function macd(values: number[], fast: number, slow: number, signalPeriod: number): MacdResult {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine: Series = values.map((_, i) => {
    const f = emaFast[i];
    const s = emaSlow[i];
    return f === null || s === null ? null : f - s;
  });
  const firstIdx = macdLine.findIndex((v) => v !== null);
  let signalLine: Series = new Array(values.length).fill(null);
  if (firstIdx >= 0) {
    const trimmed = macdLine.slice(firstIdx).map((v) => v as number);
    const sigTrim = ema(trimmed, signalPeriod);
    for (let i = 0; i < sigTrim.length; i++) {
      signalLine[i + firstIdx] = sigTrim[i];
    }
  }
  const hist: Series = macdLine.map((m, i) => {
    const s = signalLine[i];
    return m === null || s === null ? null : m - s;
  });
  return { macd: macdLine, signal: signalLine, hist };
}

export interface BBandsResult {
  upper: Series;
  middle: Series;
  lower: Series;
}

export function bbands(values: number[], period: number, stddevMult: number): BBandsResult {
  const middle = sma(values, period);
  const upper: Series = new Array(values.length).fill(null);
  const lower: Series = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const mean = middle[i];
    if (mean === null) continue;
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j] - mean;
      sumSq += d * d;
    }
    const sd = Math.sqrt(sumSq / period);
    upper[i] = mean + stddevMult * sd;
    lower[i] = mean - stddevMult * sd;
  }
  return { upper, middle, lower };
}

export function atr(bars: Bar[], period: number): Series {
  const out: Series = new Array(bars.length).fill(null);
  if (bars.length === 0 || period <= 0) return out;
  const tr: number[] = new Array(bars.length).fill(0);
  tr[0] = bars[0].high - bars[0].low;
  for (let i = 1; i < bars.length; i++) {
    const h = bars[i].high;
    const l = bars[i].low;
    const pc = bars[i - 1].close;
    tr[i] = Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  }
  if (bars.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += tr[i];
  out[period - 1] = sum / period;
  for (let i = period; i < bars.length; i++) {
    const prev = out[i - 1] as number;
    out[i] = (prev * (period - 1) + tr[i]) / period;
  }
  return out;
}

export function stddev(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  const means = sma(values, period);
  for (let i = period - 1; i < values.length; i++) {
    const m = means[i];
    if (m === null) continue;
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j] - m;
      sumSq += d * d;
    }
    out[i] = Math.sqrt(sumSq / period);
  }
  return out;
}

export function highest(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let m = -Infinity;
    for (let j = i - period + 1; j <= i; j++) if (values[j] > m) m = values[j];
    out[i] = m;
  }
  return out;
}

export function lowest(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let m = Infinity;
    for (let j = i - period + 1; j <= i; j++) if (values[j] < m) m = values[j];
    out[i] = m;
  }
  return out;
}

export function computeIndicator(ind: Indicator, bars: Bar[]): Series {
  switch (ind.type) {
    case "SMA":
      return sma(priceSeries(bars, ind.source), ind.period);
    case "EMA":
      return ema(priceSeries(bars, ind.source), ind.period);
    case "RSI":
      return rsi(priceSeries(bars, ind.source), ind.period);
    case "MACD": {
      const r = macd(priceSeries(bars, ind.source), ind.fast, ind.slow, ind.signal);
      return r[ind.output];
    }
    case "BBANDS": {
      const r = bbands(priceSeries(bars, ind.source), ind.period, ind.stddev);
      return r[ind.output];
    }
    case "ATR":
      return atr(bars, ind.period);
    case "STDDEV":
      return stddev(priceSeries(bars, ind.source), ind.period);
    case "HIGHEST":
      return highest(priceSeries(bars, ind.source), ind.period);
    case "LOWEST":
      return lowest(priceSeries(bars, ind.source), ind.period);
    default: {
      const _exhaustive: never = ind;
      throw new Error(`Unknown indicator: ${String(_exhaustive)}`);
    }
  }
}

export function computeAll(indicators: Indicator[], bars: Bar[]): Record<string, Series> {
  const out: Record<string, Series> = {};
  for (const ind of indicators) {
    out[ind.id] = computeIndicator(ind, bars);
  }
  return out;
}

export function warmupBars(ind: Indicator): number {
  switch (ind.type) {
    case "SMA":
    case "EMA":
    case "STDDEV":
    case "HIGHEST":
    case "LOWEST":
      return ind.period;
    case "RSI":
      return ind.period + 1;
    case "MACD":
      return ind.slow + ind.signal;
    case "BBANDS":
      return ind.period;
    case "ATR":
      return ind.period;
    default: {
      const _exhaustive: never = ind;
      throw new Error(`Unknown indicator: ${String(_exhaustive)}`);
    }
  }
}
