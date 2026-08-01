import { NextResponse } from "next/server";
import { DeepgramClient } from "@deepgram/sdk";

export const dynamic = "force-dynamic";

/**
 * GET /api/deepgram/key
 *
 * SDK v5 grants short-lived JWTs (`auth.v1.tokens.grant`) rather than minting
 * project API keys, which is what we want — the real DEEPGRAM_API_KEY can
 * create keys and spend money, so it must never reach the browser.
 *
 * Returns { enabled: false } when unconfigured — the UI's signal to stay in
 * scripted-conversation mode.
 */
export async function GET(): Promise<NextResponse> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ enabled: false, reason: "no DEEPGRAM_API_KEY" });
  }

  try {
    const dg = new DeepgramClient({ apiKey });
    // Default TTL is 30s; a demo turn can easily outlast that.
    const res = await dg.auth.v1.tokens.grant({ ttl_seconds: 3600 });

    if (!res?.access_token) {
      return NextResponse.json({ enabled: false, reason: "no access_token" });
    }

    return NextResponse.json({
      enabled: true,
      key: res.access_token,
      expiresIn: res.expires_in,
    });
  } catch (err) {
    return NextResponse.json({
      enabled: false,
      reason: (err as Error).message,
    });
  }
}
