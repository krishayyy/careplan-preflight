/**
 * Self-test — runs the whole compile path with NO credentials.
 *
 *   npx tsx scripts/selftest.ts
 *
 * Exercises corpus → Moss fallback → Stedi fallback → buildNodes → propagate →
 * summarize. Proves the demo-safe path works before any key exists, and proves
 * it still works if every integration dies at 4pm.
 */
import { buildNodes } from "../lib/preflight/build-nodes";
import { summarize, type PatientConstraints } from "../lib/types";
import { retrieve } from "../lib/moss/retrieve";
import type { CarePlanBundle } from "../lib/medplum/read";

const FAKE_BUNDLE = {
  patient: { resourceType: "Patient", id: "fake-patient" },
  carePlan: { resourceType: "CarePlan", id: "fake-careplan" },
  medication: { resourceType: "MedicationRequest", id: "fake-med" },
  labs: { resourceType: "ServiceRequest", id: "fake-labs" },
  existingTasks: [],
} as unknown as CarePlanBundle;

const PAD = 24;
let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "✓" : "✗"} ${label.padEnd(46)} ${ok ? "" : `got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`}`
  );
}

function table(nodes: Awaited<ReturnType<typeof buildNodes>>["nodes"]) {
  for (const n of nodes) {
    const lat = n.retrievalLatencyMs !== undefined ? `${n.retrievalLatencyMs}ms` : "";
    console.log(
      `    ${n.id.padEnd(PAD)} ${n.status.padEnd(26)} ${n.sourceType.padEnd(20)} ${lat}`
    );
  }
}

async function main() {
  console.log("\n═══ 1. Moss retrieval (fallback mode) ═══\n");

  const sat = await retrieve("patient unable to attend weekday lab hours saturday");
  console.log(`    query → ${sat.docName}  (${sat.latencyMs}ms)`);
  console.log(`    excerpt: "${sat.excerpt}"\n`);
  check("saturday query returns Northside", sat.ruleId, "northside-lab-hours");

  const dose = await retrieve("methotrexate dosing frequency weekly");
  console.log(`\n    query → ${dose.docName}  (${dose.latencyMs}ms)`);
  console.log(`    excerpt: "${dose.excerpt}"\n`);
  check("dosing query returns protocol", dose.ruleId, "methotrexate-protocol");

  // ── initial state ─────────────────────────────────────────────────────────
  console.log("\n═══ 2. Initial compile (pre-conversation) ═══\n");
  const initial = await buildNodes(FAKE_BUNDLE, {});
  table(initial.nodes);
  const s0 = summarize(initial.nodes);
  console.log(`\n    ${JSON.stringify(s0)}`);
  check("build does not pass initially", s0.buildPassing, false);

  // SAFETY: nothing may read "pass" before any evidence has been gathered.
  const byId0 = Object.fromEntries(initial.nodes.map((n) => [n.id, n]));
  check("lab-access not asserted pre-conversation", byId0["lab-access"].status, "pending");
  check("dosing not asserted pre-conversation", byId0["dosing-comprehension"].status, "pending");
  check("no node claims pass without evidence", initial.nodes.some((n) => n.status === "pass"), false);

  // ── after the conversation surfaces both problems ─────────────────────────
  console.log("\n═══ 3. After voice conversation ═══\n");
  const afterVoice: PatientConstraints = {
    believedDosingFrequency: "daily",
    weekdayLabAvailable: false,
  };
  const voiced = await buildNodes(FAKE_BUNDLE, afterVoice);
  table(voiced.nodes);
  const s1 = summarize(voiced.nodes);
  console.log(`\n    ${JSON.stringify(s1)}`);

  const byId = Object.fromEntries(voiced.nodes.map((n) => [n.id, n]));
  check("lab-access blocked", byId["lab-access"].status, "blocked");
  check("dosing-comprehension blocked", byId["dosing-comprehension"].status, "blocked");
  check("safety-ack blocked", byId["safety-ack"].status, "blocked");
  check("payer needs verification", byId["payer-verification"].status, "needs_human_verification");
  check("baseline-labs waits (pending)", byId["baseline-labs"].status, "pending");
  check("medication-start waits (pending)", byId["medication-start"].status, "pending");
  check("3 blocked", s1.blocked, 3);
  check("1 needs verification", s1.needsVerification, 1);
  check("build fails", s1.buildPassing, false);

  // ── after booking the Saturday slot ───────────────────────────────────────
  console.log("\n═══ 4. After booking Saturday slot ═══\n");
  const booked = await buildNodes(FAKE_BUNDLE, {
    ...afterVoice,
    acceptsSaturdaySlot: true,
  });
  table(booked.nodes);
  const s2 = summarize(booked.nodes);
  console.log(`\n    ${JSON.stringify(s2)}`);

  const byId2 = Object.fromEntries(booked.nodes.map((n) => [n.id, n]));
  check("lab-access resolved", byId2["lab-access"].status, "resolved");
  check("lab-access has resolvedAt", typeof byId2["lab-access"].resolvedAt, "string");
  check("blocked drops to 2", s2.blocked, 2);

  // SAFETY: booking the slot does NOT mean the labs were drawn or reviewed.
  check("baseline-labs still pending after booking", byId2["baseline-labs"].status, "pending");
  check("clinician-review still pending", byId2["clinician-review"].status, "pending");
  check("medication-start still gated", byId2["medication-start"].status, "pending");
  check("build still fails", s2.buildPassing, false);

  // ── human verification clears the build ───────────────────────────────────
  console.log("\n═══ 5. Human verification → build passes ═══\n");
  const allDone = await buildNodes(FAKE_BUNDLE, {
    ...afterVoice,
    acceptsSaturdaySlot: true,
    payerVerifiedBy: "auth staff",
    safetyAckDocumentedBy: "Dr. Reyes",
    dosingConfirmedBy: "Dr. Reyes",
  });
  table(allDone.nodes);
  const s3 = summarize(allDone.nodes);
  console.log(`\n    ${JSON.stringify(s3)}`);
  check("no blockers remain", s3.blocked, 0);
  check("nothing awaiting verification", s3.needsVerification, 0);
  check("build passes", s3.buildPassing, true);

  // SAFETY: clearing the blockers still doesn't claim the work is finished.
  const byId3 = Object.fromEntries(allDone.nodes.map((n) => [n.id, n]));
  check("baseline-labs still not done", byId3["baseline-labs"].status, "pending");
  check("medication-start not asserted", byId3["medication-start"].status, "pending");

  // ── every blocker must cite a source ──────────────────────────────────────
  console.log("\n═══ 6. Citation coverage ═══\n");
  const blockers = voiced.nodes.filter(
    (n) => n.status === "blocked" || n.status === "needs_human_verification"
  );
  for (const b of blockers) {
    const cited = Boolean(b.sourceExcerpt);
    if (!cited) failures++;
    console.log(`  ${cited ? "✓" : "✗"} ${b.id.padEnd(PAD)} ← ${b.sourceReference}`);
  }
  check("every blocker cites an excerpt", blockers.every((b) => b.sourceExcerpt), true);

  console.log(`\n    degraded subsystems: ${JSON.stringify(voiced.degraded)}`);
  console.log(
    "\n" + (failures === 0 ? "✅ all checks passed" : `❌ ${failures} check(s) failed`) + "\n"
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
