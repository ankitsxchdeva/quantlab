export type Timeframe = "1d" | "1h" | "15m" | "5m" | "1m" | "1wk" | "1mo";

export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type MarketSource = "stock" | "polymarket";

export interface DataRequest {
  symbol: string;
  source: MarketSource;
  timeframe: Timeframe;
  start: string;
  end: string;
}

export interface Trade {
  side: "long" | "short";
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  qty: number;
  pnl: number;
  pnlPct: number;
  reason: "signal" | "stop_loss" | "take_profit" | "end_of_data";
}

export interface EquityPoint {
  time: number;
  equity: number;
  drawdown: number;
}

export interface BacktestMetrics {
  initialEquity: number;
  finalEquity: number;
  totalReturnPct: number;
  cagrPct: number;
  sharpe: number;
  sortino: number;
  maxDrawdownPct: number;
  winRatePct: number;
  profitFactor: number;
  totalTrades: number;
  avgTradePct: number;
  avgWinPct: number;
  avgLossPct: number;
  exposurePct: number;
  bestTradePct: number;
  worstTradePct: number;
}

export interface BenchmarkResult {
  label: string;
  initialEquity: number;
  finalEquity: number;
  totalReturnPct: number;
  cagrPct: number;
  maxDrawdownPct: number;
  equity: EquityPoint[];
}

export interface MarketResolution {
  source: MarketSource;
  symbol: string;
  label: string;
  url?: string;
}

export interface BacktestResult {
  metrics: BacktestMetrics;
  trades: Trade[];
  equity: EquityPoint[];
  bars: Bar[];
  benchmark: BenchmarkResult;
  market: MarketResolution;
  warnings: string[];
}

export type LLMProvider = "openai" | "anthropic" | "google";

export interface LLMRequest {
  provider: LLMProvider;
  apiKey: string;
  model?: string;
  prompt: string;
}
