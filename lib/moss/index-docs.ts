/**
 * One-time indexing of the rule corpus into Moss.
 *
 *   npx tsx lib/moss/index-docs.ts
 *
 * ⚠️ Smoke-test Moss first. Confirm create-index / add-doc / query works in a
 * throwaway script before running this.
 */
import { loadEnv } from "../../scripts/load-env";
loadEnv();

import { CORPUS } from "../corpus";

const INDEX = process.env.MOSS_INDEX_NAME ?? "careplan-rules";
const API = "https://service.usemoss.dev/v1";

async function main() {
  const apiKey = process.env.MOSS_API_KEY;
  if (!apiKey) throw new Error("MOSS_API_KEY missing from .env.local");

  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
  };

  // Create index (ignore "already exists")
  const created = await fetch(`${API}/indexes`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: INDEX }),
  });
  console.log(`index create → ${created.status}`);

  for (const doc of CORPUS) {
    const res = await fetch(`${API}/indexes/${INDEX}/documents`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: doc.ruleId,
        text: doc.text,
        metadata: { ruleId: doc.ruleId, docName: doc.docName },
      }),
    });
    console.log(`  ${doc.ruleId} → ${res.status}`);
    if (!res.ok) console.log(`    ${await res.text()}`);
  }

  // Verify the two queries the demo depends on
  for (const q of [
    "patient cannot attend lab on weekdays",
    "methotrexate dosing frequency",
  ]) {
    const res = await fetch(`${API}/search`, {
      method: "POST",
      headers,
      body: JSON.stringify({ index: INDEX, query: q, top_k: 1 }),
    });
    console.log(`\nquery "${q}" →`, JSON.stringify(await res.json(), null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
