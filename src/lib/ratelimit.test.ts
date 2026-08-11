import { describe, expect, it } from "vitest";
import { clientIp, createRateLimiter } from "./ratelimit";

function req(headers: Record<string, string>): Request {
  return new Request("https://example.test/api", { method: "POST", headers });
}

describe("clientIp", () => {
  it("prefers cf-connecting-ip, which Cloudflare overwrites per request", () => {
    expect(
      clientIp(req({ "cf-connecting-ip": "9.9.9.9", "x-real-ip": "8.8.8.8", "x-forwarded-for": "1.1.1.1" })),
    ).toBe("9.9.9.9");
  });

  it("falls back to x-real-ip before x-forwarded-for", () => {
    expect(clientIp(req({ "x-real-ip": "8.8.8.8", "x-forwarded-for": "1.1.1.1" }))).toBe("8.8.8.8");
  });

  // The bug this pins: reading hops[0] reads whatever the CLIENT sent, so a
  // caller could rotate it per request and never hit the limit.
  it("takes the LAST forwarded hop, not the client-supplied first one", () => {
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientIp(req({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("is not fooled by a spoofed chain prepended by the caller", () => {
    const spoofed = clientIp(req({ "x-forwarded-for": "evil-1, evil-2, 203.0.113.7" }));
    const alsoSpoofed = clientIp(req({ "x-forwarded-for": "totally-different, 203.0.113.7" }));
    expect(spoofed).toBe("203.0.113.7");
    // Both requests key to the same bucket, so rotating the prefix buys nothing.
    expect(alsoSpoofed).toBe(spoofed);
  });

  it("tolerates whitespace and empty hops", () => {
    expect(clientIp(req({ "x-forwarded-for": " 1.1.1.1 ,  , 203.0.113.7  " }))).toBe("203.0.113.7");
  });

  it("falls back to a constant when no forwarding headers are present", () => {
    expect(clientIp(req({}))).toBe("local");
  });
});

describe("createRateLimiter", () => {
  it("allows exactly `limit` calls in a window, then blocks", () => {
    const rl = createRateLimiter(3, 60_000);
    const t = 1_000_000;
    expect(rl.isLimited("a", t)).toBe(false);
    expect(rl.isLimited("a", t + 1)).toBe(false);
    expect(rl.isLimited("a", t + 2)).toBe(false);
    expect(rl.isLimited("a", t + 3)).toBe(true);
    expect(rl.isLimited("a", t + 4)).toBe(true);
  });

  it("keeps buckets independent per key", () => {
    const rl = createRateLimiter(1, 60_000);
    const t = 1_000_000;
    expect(rl.isLimited("a", t)).toBe(false);
    expect(rl.isLimited("b", t)).toBe(false);
    expect(rl.isLimited("a", t)).toBe(true);
  });

  it("lets the allowance recover once the window rolls past", () => {
    const rl = createRateLimiter(2, 60_000);
    const t = 1_000_000;
    rl.isLimited("a", t);
    rl.isLimited("a", t);
    expect(rl.isLimited("a", t)).toBe(true);
    expect(rl.isLimited("a", t + 60_001)).toBe(false);
  });

  // The /api/arb copy never swept, so its Map grew one entry per distinct key
  // for the life of the process -- and the key comes from a request header.
  it("evicts stale buckets instead of growing forever", () => {
    const rl = createRateLimiter(5, 60_000);
    const t = 1_000_000;
    for (let i = 0; i < 500; i++) rl.isLimited(`ip-${i}`, t);
    expect(rl.size()).toBe(500);

    // One call a full window later triggers the sweep; every stale key goes.
    rl.isLimited("fresh", t + 120_000);
    expect(rl.size()).toBe(1);
  });
});
