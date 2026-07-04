import { describe, it, expect } from "vitest";
import { StrategySchema, type Strategy } from "@/lib/strategy/schema";
import { validateStrategy } from "./validate";

function makeStrategy(overrides: Partial<Strategy>): Strategy {
  return StrategySchema.parse({
    name: "Test",
    asset: "SPY",
    entries: [{ side: "long", when: { op: ">", left: { price: "close" }, right: 100 } }],
    ...overrides,
  });
}

describe("validateStrategy", () => {
  it("returns no errors for a clean strategy", () => {
    const strategy = makeStrategy({
      indicators: [
        { id: "sma_fast", type: "SMA", source: "close", period: 50 },
        { id: "sma_slow", type: "SMA", source: "close", period: 200 },
      ],
      entries: [
        { side: "long", when: { op: "crosses_above", left: { ref: "sma_fast" }, right: { ref: "sma_slow" } } },
      ],
      exits: [
        { when: { op: "crosses_below", left: "sma_fast", right: { ref: "sma_slow" } } },
      ],
    });
    expect(validateStrategy(strategy)).toEqual([]);
  });

  it("flags a { ref } that does not resolve to a declared indicator", () => {
    const strategy = makeStrategy({
      indicators: [{ id: "rsi_14", type: "RSI", source: "close", period: 14 }],
      entries: [{ side: "long", when: { op: "<", left: { ref: "rsi_2" }, right: 30 } }],
    });
    const errors = validateStrategy(strategy);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("entries[0]");
    expect(errors[0]).toContain('"rsi_2"');
    expect(errors[0]).toContain("rsi_14");
  });

  it("flags a bare-string reference that is neither indicator id nor price source", () => {
    const strategy = makeStrategy({
      entries: [{ side: "long", when: { op: ">", left: "momentum", right: 0 } }],
    });
    const errors = validateStrategy(strategy);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('"momentum"');
  });

  it("accepts bare-string price sources and indicator ids", () => {
    const strategy = makeStrategy({
      indicators: [{ id: "sma_20", type: "SMA", source: "close", period: 20 }],
      entries: [{ side: "long", when: { op: ">", left: "close", right: "sma_20" } }],
    });
    expect(validateStrategy(strategy)).toEqual([]);
  });

  it("flags indicator ids that shadow price source names", () => {
    const strategy = makeStrategy({
      indicators: [{ id: "close", type: "SMA", source: "close", period: 20 }],
      entries: [{ side: "long", when: { op: ">", left: { ref: "close" }, right: 100 } }],
    });
    const errors = validateStrategy(strategy);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("shadows");
  });

  it("flags duplicate indicator ids", () => {
    const strategy = makeStrategy({
      indicators: [
        { id: "sma", type: "SMA", source: "close", period: 20 },
        { id: "sma", type: "SMA", source: "close", period: 50 },
      ],
      entries: [{ side: "long", when: { op: ">", left: { ref: "sma" }, right: 100 } }],
    });
    const errors = validateStrategy(strategy);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("duplicate");
  });

  it("walks nested conditions and arithmetic operands in exits", () => {
    const strategy = makeStrategy({
      exits: [
        {
          when: {
            op: "and",
            conditions: [
              { op: "not", condition: { op: "<", left: { ref: "ghost" }, right: 0 } },
              {
                op: ">",
                left: { price: "close" },
                right: { op: "*", left: { ref: "phantom" }, right: 1.02 },
              },
            ],
          },
        },
      ],
    });
    const errors = validateStrategy(strategy);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain("exits[0]");
    expect(errors[0]).toContain('"ghost"');
    expect(errors[1]).toContain('"phantom"');
  });
});
