import { z } from "zod";

export const PriceSourceSchema = z.enum(["open", "high", "low", "close", "volume", "hl2", "hlc3", "ohlc4"]);
export type PriceSource = z.infer<typeof PriceSourceSchema>;

export const IndicatorSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string(), type: z.literal("SMA"), source: PriceSourceSchema.default("close"), period: z.number().int().positive() }),
  z.object({ id: z.string(), type: z.literal("EMA"), source: PriceSourceSchema.default("close"), period: z.number().int().positive() }),
  z.object({ id: z.string(), type: z.literal("RSI"), source: PriceSourceSchema.default("close"), period: z.number().int().positive().default(14) }),
  z.object({
    id: z.string(),
    type: z.literal("MACD"),
    source: PriceSourceSchema.default("close"),
    fast: z.number().int().positive().default(12),
    slow: z.number().int().positive().default(26),
    signal: z.number().int().positive().default(9),
    output: z.enum(["macd", "signal", "hist"]).default("macd"),
  }),
  z.object({
    id: z.string(),
    type: z.literal("BBANDS"),
    source: PriceSourceSchema.default("close"),
    period: z.number().int().positive().default(20),
    stddev: z.number().positive().default(2),
    output: z.enum(["upper", "middle", "lower"]).default("middle"),
  }),
  z.object({ id: z.string(), type: z.literal("ATR"), period: z.number().int().positive().default(14) }),
  z.object({ id: z.string(), type: z.literal("STDDEV"), source: PriceSourceSchema.default("close"), period: z.number().int().positive().default(20) }),
  z.object({
    id: z.string(),
    type: z.literal("HIGHEST"),
    source: PriceSourceSchema.default("high"),
    period: z.number().int().positive(),
  }),
  z.object({
    id: z.string(),
    type: z.literal("LOWEST"),
    source: PriceSourceSchema.default("low"),
    period: z.number().int().positive(),
  }),
]);
export type Indicator = z.infer<typeof IndicatorSchema>;

const OperandSchema: z.ZodType<Operand> = z.lazy(() =>
  z.union([
    z.number(),
    z.string(),
    z.object({ ref: z.string() }),
    z.object({ price: PriceSourceSchema }),
    z.object({ const: z.number() }),
    z.object({ op: z.enum(["+", "-", "*", "/"]), left: OperandSchema, right: OperandSchema }),
  ]),
);

export type Operand =
  | number
  | string
  | { ref: string }
  | { price: PriceSource }
  | { const: number }
  | { op: "+" | "-" | "*" | "/"; left: Operand; right: Operand };

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion("op", [
    z.object({ op: z.literal(">"), left: OperandSchema, right: OperandSchema }),
    z.object({ op: z.literal(">="), left: OperandSchema, right: OperandSchema }),
    z.object({ op: z.literal("<"), left: OperandSchema, right: OperandSchema }),
    z.object({ op: z.literal("<="), left: OperandSchema, right: OperandSchema }),
    z.object({ op: z.literal("=="), left: OperandSchema, right: OperandSchema }),
    z.object({ op: z.literal("crosses_above"), left: OperandSchema, right: OperandSchema }),
    z.object({ op: z.literal("crosses_below"), left: OperandSchema, right: OperandSchema }),
    z.object({ op: z.literal("and"), conditions: z.array(ConditionSchema).min(1) }),
    z.object({ op: z.literal("or"), conditions: z.array(ConditionSchema).min(1) }),
    z.object({ op: z.literal("not"), condition: ConditionSchema }),
  ]),
);

export type Condition =
  | { op: ">" | ">=" | "<" | "<=" | "=="; left: Operand; right: Operand }
  | { op: "crosses_above" | "crosses_below"; left: Operand; right: Operand }
  | { op: "and" | "or"; conditions: Condition[] }
  | { op: "not"; condition: Condition };

export const EntryRuleSchema = z.object({
  side: z.enum(["long", "short"]),
  when: ConditionSchema,
});
export type EntryRule = z.infer<typeof EntryRuleSchema>;

export const ExitRuleSchema = z.object({
  when: ConditionSchema,
  reason: z.string().optional(),
});
export type ExitRule = z.infer<typeof ExitRuleSchema>;

export const RiskSchema = z.object({
  positionSizePct: z.number().min(0).max(100).default(100),
  stopLossPct: z.number().min(0).max(100).optional(),
  takeProfitPct: z.number().min(0).max(1000).optional(),
  maxBarsInTrade: z.number().int().positive().optional(),
});
export type Risk = z.infer<typeof RiskSchema>;

export const TimeframeSchema = z.enum(["1d", "1h", "15m", "5m", "1m", "1wk", "1mo"]);

export const MarketSchema = z.enum(["stock", "polymarket"]);
export type Market = z.infer<typeof MarketSchema>;

export const StrategySchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  asset: z.string(),
  market: MarketSchema.default("stock"),
  timeframe: TimeframeSchema.default("1d"),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  initialEquity: z.number().positive().default(10_000),
  indicators: z.array(IndicatorSchema).default([]),
  entries: z.array(EntryRuleSchema).min(1),
  exits: z.array(ExitRuleSchema).default([]),
  risk: RiskSchema.default({ positionSizePct: 100 }),
  allowShort: z.boolean().default(false),
});

export type Strategy = z.infer<typeof StrategySchema>;
