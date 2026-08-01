/**
 * Seeds the demo patient and care plan into Medplum.
 *
 *   npx tsx scripts/seed.ts
 *
 * Idempotent: deletes anything tagged `seed` first, so run it as often as you like.
 * Prints the env block to paste into .env.local at the end.
 */
import { loadEnv, requireEnv } from "./load-env";
loadEnv();
requireEnv(["MEDPLUM_CLIENT_ID", "MEDPLUM_CLIENT_SECRET"]);

import { getMedplum, SEED_TAG } from "../lib/medplum/client";
import { CORPUS } from "../lib/corpus";
import type {
  Patient,
  Coverage,
  CarePlan,
  MedicationRequest,
  ServiceRequest,
  DocumentReference,
  Schedule,
  Slot,
  Resource,
} from "@medplum/fhirtypes";

const TAG = { meta: { tag: [SEED_TAG] } };

/** Next Saturday at 10:00 local, as an ISO string. */
function nextSaturday(hour: number, minute = 0): string {
  const d = new Date();
  const daysUntilSat = (6 - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + daysUntilSat);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

const RESOURCE_TYPES = [
  "Appointment",
  "Task",
  "Provenance",
  "Slot",
  "Schedule",
  "DocumentReference",
  "CarePlan",
  "MedicationRequest",
  "ServiceRequest",
  "Coverage",
  "Patient",
] as const;

async function wipe(medplum: Awaited<ReturnType<typeof getMedplum>>) {
  for (const resourceType of RESOURCE_TYPES) {
    const found = (await medplum.searchResources(resourceType as never, {
      _tag: `${SEED_TAG.system}|${SEED_TAG.code}`,
      _count: 100,
    })) as Resource[];
    for (const r of found) {
      if (r.id) {
        await medplum.deleteResource(r.resourceType as never, r.id);
      }
    }
    if (found.length) console.log(`  wiped ${found.length} ${resourceType}`);
  }
}

async function main() {
  const medplum = await getMedplum();
  console.log("→ connected to Medplum\n");

  console.log("wiping previous seed…");
  await wipe(medplum);

  // ── Patient ───────────────────────────────────────────────────────────────
  const patient = await medplum.createResource<Patient>({
    resourceType: "Patient",
    ...TAG,
    name: [{ given: ["Maya"], family: "Thompson" }],
    gender: "female",
    birthDate: "1992-03-14",
    telecom: [{ system: "phone", value: "555-0142", use: "mobile" }],
    address: [{ city: "San Francisco", state: "CA", postalCode: "94110" }],
  });

  // ── Coverage ──────────────────────────────────────────────────────────────
  // subscriberId / payor must match whatever Stedi test mode expects.
  const coverage = await medplum.createResource<Coverage>({
    resourceType: "Coverage",
    ...TAG,
    status: "active",
    beneficiary: { reference: `Patient/${patient.id}` },
    subscriberId: process.env.STEDI_TEST_MEMBER_ID ?? "TEST-MEMBER-001",
    payor: [{ display: process.env.STEDI_TEST_PAYER ?? "Test Payer" }],
  });

  // ── MedicationRequest ─────────────────────────────────────────────────────
  const medication = await medplum.createResource<MedicationRequest>({
    resourceType: "MedicationRequest",
    ...TAG,
    status: "draft",
    intent: "proposal",
    subject: { reference: `Patient/${patient.id}` },
    medicationCodeableConcept: {
      coding: [
        {
          system: "http://www.nlm.nih.gov/research/umls/rxnorm",
          code: "6851",
          display: "Methotrexate",
        },
      ],
      text: "Methotrexate 15 mg oral tablet",
    },
    dosageInstruction: [
      {
        text: "Take 15 mg by mouth ONCE WEEKLY",
        timing: { repeat: { frequency: 1, period: 1, periodUnit: "wk" } },
      },
    ],
  });

  // ── ServiceRequest ────────────────────────────────────────────────────────
  const labs = await medplum.createResource<ServiceRequest>({
    resourceType: "ServiceRequest",
    ...TAG,
    status: "active",
    intent: "order",
    subject: { reference: `Patient/${patient.id}` },
    code: { text: "Baseline CBC, hepatic function panel, serum creatinine" },
  });

  // ── CarePlan ──────────────────────────────────────────────────────────────
  const carePlan = await medplum.createResource<CarePlan>({
    resourceType: "CarePlan",
    ...TAG,
    status: "active",
    intent: "plan",
    title: "Plaque psoriasis — methotrexate initiation",
    subject: { reference: `Patient/${patient.id}` },
    description:
      "Start methotrexate once weekly. Complete baseline CBC, hepatic panel, " +
      "and creatinine. Return for follow-up four weeks after treatment begins.",
    activity: [
      { reference: { reference: `MedicationRequest/${medication.id}` } },
      { reference: { reference: `ServiceRequest/${labs.id}` } },
    ],
  });

  // ── Rule documents ────────────────────────────────────────────────────────
  const docIds: Record<string, string> = {};
  for (const doc of CORPUS) {
    const created = await medplum.createResource<DocumentReference>({
      resourceType: "DocumentReference",
      ...TAG,
      status: "current",
      description: doc.docName,
      identifier: [
        { system: "https://careplan-preflight.dev/rule", value: doc.ruleId },
      ],
      content: [
        {
          attachment: {
            contentType: "text/plain",
            title: doc.docName,
            data: Buffer.from(doc.text, "utf-8").toString("base64"),
          },
        },
      ],
    });
    docIds[doc.ruleId] = created.id!;
  }

  // ── Schedule + Slot ───────────────────────────────────────────────────────
  // ⚠️ Without a free Slot there is nothing to book at 14:00. Do not skip.
  const schedule = await medplum.createResource<Schedule>({
    resourceType: "Schedule",
    ...TAG,
    active: true,
    actor: [{ display: "Northside Laboratory" }],
    comment: "Saturday phlebotomy — 8:00 AM to 12:00 PM",
  });

  const slot = await medplum.createResource<Slot>({
    resourceType: "Slot",
    ...TAG,
    schedule: { reference: `Schedule/${schedule.id}` },
    status: "free",
    start: nextSaturday(10, 0),
    end: nextSaturday(10, 30),
  });

  console.log("\n✅ seed complete\n");
  console.log("── paste into .env.local ──────────────────────────────");
  console.log(`SEED_PATIENT_ID=${patient.id}`);
  console.log(`SEED_COVERAGE_ID=${coverage.id}`);
  console.log(`SEED_CAREPLAN_ID=${carePlan.id}`);
  console.log(`SEED_MEDICATIONREQUEST_ID=${medication.id}`);
  console.log(`SEED_SERVICEREQUEST_ID=${labs.id}`);
  console.log(`SEED_SCHEDULE_ID=${schedule.id}`);
  console.log(`SEED_SATURDAY_SLOT_ID=${slot.id}`);
  console.log(`SEED_DOC_IDS=${JSON.stringify(docIds)}`);
  console.log("───────────────────────────────────────────────────────");
  console.log(`\nSaturday slot: ${slot.start}`);
}

main().catch((err) => {
  console.error("\n❌ seed failed:", err);
  process.exit(1);
});
