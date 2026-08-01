import { MedplumClient, ClientStorage, MemoryStorage } from "@medplum/core";

let cached: MedplumClient | null = null;

/**
 * Server-side Medplum client using client-credentials auth.
 * Create a ClientApplication at app.medplum.com → Admin → Client Applications.
 */
export async function getMedplum(): Promise<MedplumClient> {
  if (cached) return cached;

  const baseUrl = process.env.MEDPLUM_BASE_URL ?? "https://api.medplum.com/";
  const clientId = process.env.MEDPLUM_CLIENT_ID;
  const clientSecret = process.env.MEDPLUM_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "MEDPLUM_CLIENT_ID / MEDPLUM_CLIENT_SECRET missing from .env.local"
    );
  }

  // Node 22 exposes a partial `localStorage` global, which defeats Medplum's
  // browser-vs-server auto-detection and blows up inside ClientStorage. Pass an
  // in-memory store explicitly so this works in scripts and route handlers alike.
  const medplum = new MedplumClient({
    baseUrl,
    storage: new ClientStorage(new MemoryStorage()),
  });

  await medplum.startClientLogin(clientId, clientSecret);
  cached = medplum;
  return medplum;
}

/** Tag applied to every seeded resource so the seed script can clean up. */
export const SEED_TAG = {
  system: "https://careplan-preflight.dev/tags",
  code: "seed",
};
