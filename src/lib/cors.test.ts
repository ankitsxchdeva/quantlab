import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextResponse } from "next/server";
import { corsHeaders, preflight, withCors } from "./cors";

const PAGES = "https://ankitsxchdeva.github.io";

function req(origin?: string): Request {
  return new Request("https://api.example.com/api/arb", {
    method: "POST",
    ...(origin ? { headers: { origin } } : {}),
  });
}

describe("cors", () => {
  const original = process.env.ALLOWED_ORIGINS;

  beforeEach(() => {
    process.env.ALLOWED_ORIGINS = PAGES;
  });

  afterEach(() => {
    if (original === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = original;
  });

  it("allows a configured origin", () => {
    expect(corsHeaders(req(PAGES))["Access-Control-Allow-Origin"]).toBe(PAGES);
  });

  it("refuses an origin that is not on the allowlist", () => {
    expect(corsHeaders(req("https://evil.example"))).toEqual({});
  });

  it("emits nothing for same-origin requests, which send no Origin header", () => {
    expect(corsHeaders(req())).toEqual({});
  });

  it("keeps localhost working even when an allowlist is configured", () => {
    expect(corsHeaders(req("http://localhost:3000"))["Access-Control-Allow-Origin"]).toBe(
      "http://localhost:3000",
    );
  });

  it("ignores a trailing slash on either side", () => {
    process.env.ALLOWED_ORIGINS = `${PAGES}/`;
    expect(corsHeaders(req(`${PAGES}/`))["Access-Control-Allow-Origin"]).toBe(PAGES);
  });

  it("varies on Origin so a cache cannot leak one origin's headers to another", () => {
    expect(corsHeaders(req(PAGES)).Vary).toBe("Origin");
  });

  it("answers preflight with 204 and the allow headers", () => {
    const res = preflight(req(PAGES));
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(PAGES);
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("attaches headers to an existing response without disturbing its body", async () => {
    const res = withCors(NextResponse.json({ ok: true }, { status: 429 }), req(PAGES));
    expect(res.status).toBe(429);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(PAGES);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });
});
