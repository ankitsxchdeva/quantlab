/**
 * Per-instance in-memory rate limiting, shared by every API route.
 *
 * This lived twice, inlined in the two route files, and the copies had already
 * drifted: one swept expired buckets and the other grew its Map forever. One
 * implementation with one set of tests is the fix for that class of bug, not a
 * second careful copy.
 *
 * For a multi-instance deploy, swap the Map for a shared store (Redis/Upstash)
 * keyed exactly the same way. Nothing else here needs to change.
 */

/**
 * The caller's address, chosen to be one the caller cannot choose for itself.
 *
 * `x-forwarded-for` is a client-supplied header that proxies APPEND to. Reading
 * its first entry -- which both routes used to do -- reads whatever the client
 * put there, so anyone could sidestep the limiter entirely by sending a fresh
 * random value per request. The heavy Kalshi crawl behind /api/arb makes that
 * worth getting right.
 *
 * Preference order, most trustworthy first:
 *   cf-connecting-ip  Cloudflare overwrites this on every request, so a
 *                     client-supplied value cannot survive the tunnel.
 *   x-real-ip         Set by nginx-style reverse proxies, not forwarded through.
 *   x-forwarded-for   LAST entry only: appended by the nearest proxy, so it is
 *                     the address our own upstream actually observed. Earlier
 *                     entries are hearsay from whoever sent the request.
 */
export function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;

  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;

  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }

  return "local";
}

export interface RateLimiter {
  /** True when this key has already used its allowance in the current window. */
  isLimited(key: string, now: number): boolean;
  /** Live bucket count. Exposed so tests can assert eviction actually happens. */
  size(): number;
}

export function createRateLimiter(limit: number, windowMs: number): RateLimiter {
  const buckets = new Map<string, number[]>();
  let lastSweep = 0;

  return {
    isLimited(key: string, now: number): boolean {
      // Without this sweep the Map grows one entry per distinct key forever,
      // and the key is derived from a request header, so the growth is driven
      // by whoever is calling. Sweeping at most once per window keeps it O(1)
      // amortised.
      if (now - lastSweep > windowMs) {
        lastSweep = now;
        for (const [k, times] of buckets) {
          const fresh = times.filter((t) => now - t < windowMs);
          if (fresh.length === 0) buckets.delete(k);
          else buckets.set(k, fresh);
        }
      }

      const times = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
      const limited = times.length >= limit;
      if (!limited) times.push(now);
      // An empty array is still stored, so the next sweep is what reclaims it.
      buckets.set(key, times);
      return limited;
    },

    size(): number {
      return buckets.size;
    },
  };
}
