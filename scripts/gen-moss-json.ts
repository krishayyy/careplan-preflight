/**
 * Emits the rule corpus as a JSON array for Moss's "Create New Index" upload.
 *
 *   npx tsx scripts/gen-moss-json.ts
 *
 * Writes moss-corpus.json in the project root. If Moss's expected field names
 * differ (check the shape a sample template fills in), adjust `shape()` below
 * and re-run — lib/corpus.ts stays the single source of truth either way.
 */
import fs from "node:fs";
import path from "node:path";
import { CORPUS } from "../lib/corpus";

function shape(doc: (typeof CORPUS)[number]) {
  return {
    id: doc.ruleId,
    text: doc.text,
    metadata: {
      ruleId: doc.ruleId,
      docName: doc.docName,
    },
  };
}

const out = CORPUS.map(shape);
const dest = path.join(process.cwd(), "moss-corpus.json");
fs.writeFileSync(dest, JSON.stringify(out, null, 2));

console.log(`\n✅ wrote ${dest}  (${out.length} documents)\n`);
console.log(JSON.stringify(out, null, 2));
