import { DeepgramClient } from "@deepgram/sdk";

export const dynamic = "force-dynamic";

/**
 * POST /api/deepgram/speak  { text }
 *
 * 501 when unconfigured — the client then falls back to the browser's
 * speechSynthesis so the readback still has a voice either way.
 */
export async function POST(req: Request): Promise<Response> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    return new Response("deepgram not configured", { status: 501 });
  }

  const { text } = (await req.json()) as { text?: string };
  if (!text?.trim()) return new Response("missing text", { status: 400 });

  try {
    const dg = new DeepgramClient({ apiKey });
    const audio = await dg.speak.v1.audio.generate({
      text,
      model: "aura-2-thalia-en",
      encoding: "linear16",
      container: "wav",
    });

    // v5 returns a BinaryResponse — normalise to something Response accepts.
    const body =
      audio instanceof Response
        ? audio.body
        : ((audio as unknown as { stream?: ReadableStream }).stream ??
          (audio as unknown as ReadableStream));

    return new Response(body as BodyInit, {
      headers: { "content-type": "audio/wav", "cache-control": "no-store" },
    });
  } catch (err) {
    return new Response((err as Error).message, { status: 502 });
  }
}
