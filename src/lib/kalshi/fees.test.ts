import { describe, expect, it } from "vitest";
import { takerFeeCents, takerFeePerContract } from "./fees";

describe("takerFeeCents", () => {
  it("matches the published quadratic schedule", () => {
    // ceil(0.07 * C * p * (1 - p)) in cents.
    expect(takerFeeCents(50, 1)).toBe(2); // 1.75 -> 2
    expect(takerFeeCents(71, 100)).toBe(145); // 144.13 -> 145
    expect(takerFeeCents(4, 100)).toBe(27); // 26.88 -> 27
    expect(takerFeeCents(28, 100)).toBe(142); // 141.12 -> 142
  });

  it("peaks at 50c, which is why mid-priced parlays are expensive to hedge", () => {
    const mid = takerFeeCents(50, 1000);
    expect(mid).toBeGreaterThan(takerFeeCents(10, 1000));
    expect(mid).toBeGreaterThan(takerFeeCents(90, 1000));
  });

  it("rounds up per order, not per contract", () => {
    // 100 contracts at 4c cost 27c total, far less than 100 separate 1c orders.
    expect(takerFeeCents(4, 100)).toBeLessThan(100 * takerFeeCents(4, 1));
  });
});

describe("takerFeePerContract", () => {
  it("returns zero for an empty order rather than dividing by zero", () => {
    expect(takerFeePerContract(50, 0)).toBe(0);
  });

  it("costs about 3c per contract to hedge three mid-priced legs", () => {
    const total =
      takerFeePerContract(71, 100) + takerFeePerContract(28, 100) + takerFeePerContract(4, 100);
    expect(total).toBeGreaterThan(3);
    expect(total).toBeLessThan(3.2);
  });
});
