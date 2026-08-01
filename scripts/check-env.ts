/**
 * Reports which env keys are set, WITHOUT printing any values.
 *
 *   npx tsx scripts/check-env.ts
 */
import { loadEnv } from "./load-env";
loadEnv();

const GROUPS: Record<string, string[]> = {
  Medplum: ["MEDPLUM_BASE_URL", "MEDPLUM_CLIENT_ID", "MEDPLUM_CLIENT_SECRET"],
  "Seeded IDs": [
    "SEED_PATIENT_ID",
    "SEED_CAREPLAN_ID",
    "SEED_MEDICATIONREQUEST_ID",
    "SEED_SERVICEREQUEST_ID",
    "SEED_SCHEDULE_ID",
    "SEED_SATURDAY_SLOT_ID",
  ],
  Moss: ["MOSS_API_KEY", "MOSS_INDEX_NAME"],
  Stedi: ["STEDI_API_KEY", "STEDI_TEST_PAYER_ID", "STEDI_TEST_MEMBER_ID"],
  "Person B": ["DEEPGRAM_API_KEY", "DEEPGRAM_PROJECT_ID", "ANTHROPIC_API_KEY"],
};

console.log(`\nreading ${process.cwd()}/.env.local\n`);

for (const [group, keys] of Object.entries(GROUPS)) {
  console.log(`${group}`);
  for (const k of keys) {
    const v = process.env[k]?.trim();
    const mark = v ? "✓" : "·";
    const note = v ? `set (${v.length} chars)` : "empty";
    console.log(`  ${mark} ${k.padEnd(28)} ${note}`);
  }
  console.log("");
}
