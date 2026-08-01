import { getMedplum, SEED_TAG } from "./client";
import type {
  Patient,
  CarePlan,
  MedicationRequest,
  ServiceRequest,
  Task,
  Slot,
} from "@medplum/fhirtypes";

export type CarePlanBundle = {
  patient: Patient;
  carePlan: CarePlan;
  medication: MedicationRequest;
  labs: ServiceRequest;
  existingTasks: Task[];
  saturdaySlot?: Slot;
  /** True when this is the synthetic bundle rather than live Medplum data. */
  degraded?: boolean;
};

/**
 * Synthetic bundle used when Medplum isn't configured yet. Lets `/api/preflight`
 * return a correctly-shaped response from minute one, so B is never blocked on
 * A's credentials — and so a Medplum outage at 16:00 doesn't kill the demo.
 */
const FALLBACK_BUNDLE: CarePlanBundle = {
  patient: {
    resourceType: "Patient",
    id: "demo-patient",
    name: [{ given: ["Maya"], family: "Thompson" }],
    gender: "female",
    birthDate: "1992-03-14",
  },
  carePlan: {
    resourceType: "CarePlan",
    id: "demo-careplan",
    status: "active",
    intent: "plan",
    title: "Plaque psoriasis — methotrexate initiation",
    subject: { reference: "Patient/demo-patient" },
  },
  medication: {
    resourceType: "MedicationRequest",
    id: "demo-med",
    status: "draft",
    intent: "proposal",
    subject: { reference: "Patient/demo-patient" },
    medicationCodeableConcept: { text: "Methotrexate 15 mg oral tablet" },
    dosageInstruction: [{ text: "Take 15 mg by mouth ONCE WEEKLY" }],
  },
  labs: {
    resourceType: "ServiceRequest",
    id: "demo-labs",
    status: "active",
    intent: "order",
    subject: { reference: "Patient/demo-patient" },
    code: { text: "Baseline CBC, hepatic function panel, serum creatinine" },
  },
  existingTasks: [],
};

function medplumConfigured(): boolean {
  return Boolean(
    process.env.MEDPLUM_CLIENT_ID && process.env.MEDPLUM_CLIENT_SECRET
  );
}

export async function loadCarePlanBundle(): Promise<CarePlanBundle> {
  if (!medplumConfigured()) {
    console.warn("[medplum] no credentials — using synthetic bundle");
    return { ...FALLBACK_BUNDLE, degraded: true };
  }

  try {
    return await loadFromMedplum();
  } catch (err) {
    console.warn("[medplum] read failed, using synthetic bundle:", (err as Error).message);
    return { ...FALLBACK_BUNDLE, degraded: true };
  }
}

/**
 * Every seeded resource carries the `seed` tag, so we can discover the demo
 * bundle rather than requiring eight IDs to be pasted into .env.local by hand.
 * An explicit SEED_* value still wins when present — useful if the project ever
 * holds more than one seeded patient.
 */
async function findTagged<T extends { id?: string }>(
  medplum: Awaited<ReturnType<typeof getMedplum>>,
  resourceType: string,
  envId: string | undefined
): Promise<T> {
  if (envId) {
    return (await medplum.readResource(resourceType as never, envId)) as T;
  }
  const found = (await medplum.searchResources(resourceType as never, {
    _tag: `${SEED_TAG.system}|${SEED_TAG.code}`,
    _count: 1,
    _sort: "-_lastUpdated",
  })) as unknown as T[];

  if (!found.length) {
    throw new Error(
      `no seeded ${resourceType} found — run: npx tsx scripts/seed.ts`
    );
  }
  return found[0];
}

async function loadFromMedplum(): Promise<CarePlanBundle> {
  const medplum = await getMedplum();

  const [patient, carePlan, medication, labs] = await Promise.all([
    findTagged<Patient>(medplum, "Patient", process.env.SEED_PATIENT_ID),
    findTagged<CarePlan>(medplum, "CarePlan", process.env.SEED_CAREPLAN_ID),
    findTagged<MedicationRequest>(
      medplum,
      "MedicationRequest",
      process.env.SEED_MEDICATIONREQUEST_ID
    ),
    findTagged<ServiceRequest>(
      medplum,
      "ServiceRequest",
      process.env.SEED_SERVICEREQUEST_ID
    ),
  ]);

  const existingTasks = await medplum.searchResources("Task", {
    patient: `Patient/${patient.id}`,
    _count: 50,
  });

  let saturdaySlot: Slot | undefined;
  try {
    saturdaySlot = await findTagged<Slot>(
      medplum,
      "Slot",
      process.env.SEED_SATURDAY_SLOT_ID
    );
  } catch {
    /* no slot seeded — booking will report it */
  }

  return {
    patient,
    carePlan,
    medication,
    labs,
    existingTasks: [...existingTasks],
    saturdaySlot,
  };
}
