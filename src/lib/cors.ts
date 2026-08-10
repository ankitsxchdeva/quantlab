import { NextResponse } from "next/server";

// The static UI is served from a different origin (GitHub Pages) than the API
// (home server behind a Cloudflare tunnel), so every API response needs CORS
// headers or the browser drops it.
//
// This is an allowlist, not a `*`, because these routes accept a POST body.
// It is worth being clear about what that does and does not buy: CORS is
// enforced by browsers only. It stops another site's JavaScript from calling
// this API with a user's cookies; it does not stop curl. The per-route rate
// limiter is what actually bounds abuse.
const DEFAULT_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];

function allowedOrigins(): string[] {
  const configured = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return configured.length > 0 ? [...configured, ...DEFAULT_ORIGINS] : DEFAULT_ORIGINS;
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  if (!origin) return {};

  const normalized = origin.replace(/\/+$/, "");
  const allowed = allowedOrigins();
  if (!allowed.includes(normalized) && !allowed.includes("*")) return {};

  return {
    "Access-Control-Allow-Origin": normalized,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    // Same URL yields different CORS headers per caller; without this a shared
    // cache could hand one origin's headers to another.
    Vary: "Origin",
  };
}

export function withCors<T extends NextResponse>(res: T, req: Request): T {
  for (const [key, value] of Object.entries(corsHeaders(req))) {
    res.headers.set(key, value);
  }
  return res;
}

export function preflight(req: Request): NextResponse {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}
