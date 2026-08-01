import {
  BLOCKS,
  DEPENDENCIES,
  propagate,
  type PatientConstraints,
  type PreflightNode,
} from "../types";
import { retrieve, type Retrieval } from "../moss/retrieve";
import { checkEligibility } from "../stedi/eligibility";
import type { CarePlanBundle } from "../medplum/read";

const edges = (id: PreflightNode["id"]) => ({
  dependsOn: DEPENDENCIES[id],
  blocks: BLOCKS[id],
});

/**
 * Assembles the 8 nodes from every source. This is A's core output — the
 * shape here must match B's `lib/mock.ts` exactly, field for field.
 */
export async function buildNodes(
  bundle: CarePlanBundle,
  constraints: PatientConstraints
): Promise<{ nodes: PreflightNode[]; degraded: string[] }> {
  const degraded: string[] = [];

  // ── parallel fact-gathering ───────────────────────────────────────────────
  const [eligibility, dosingRule, safetyRule, labRule] = await Promise.all([
    checkEligibility(),
    retrieve("methotrexate dosing frequency weekly"),
    retrieve("teratogenicity pregnancy counseling acknowledgment required"),
    constraints.weekdayLabAvailable === false
      ? retrieve("patient unable to attend weekday lab hours saturday")
      : retrieve("central laboratory hours"),
  ]);

  if (eligibility.degraded) degraded.push("stedi");
  for (const r of [dosingRule, safetyRule, labRule]) {
    if (r.degraded && !degraded.includes("moss")) degraded.push("moss");
  }

  // Only surface a latency figure for a genuine Moss round-trip. The local
  // fallback returns in ~0ms, and a "0ms" badge on screen reads as fabricated —
  // worse, it would claim live retrieval we didn't actually do.
  const fromMoss = (r: Retrieval) => ({
    sourceType: "moss" as const,
    sourceReference: r.docName,
    sourceExcerpt: r.excerpt,
    ...(r.degraded ? {} : { retrievalLatencyMs: r.latencyMs }),
  });

  const labResolved = constraints.acceptsSaturdaySlot === true;
  const labBlocked = constraints.weekdayLabAvailable === false && !labResolved;
  const dosingWrong =
    constraints.believedDosingFrequency === "daily" &&
    !constraints.dosingConfirmedBy;

  const now = () => new Date().toISOString();

  /** A human did the work and recorded it — the only route to `resolved`. */
  const verified = (by: string | undefined, sourceRef: string) =>
    by
      ? {
          status: "resolved" as const,
          resolvedAt: now(),
          sourceType: "deterministic_rule" as const,
          sourceReference: sourceRef,
          sourceExcerpt: `Recorded by ${by}.`,
        }
      : null;

  const nodes: PreflightNode[] = [
    {
      id: "payer-verification",
      title: "Prior authorization status",
      description: "Coverage is active; authorization requirement unresolved.",
      category: "payer",
      status: eligibility.status,
      sourceType: "stedi",
      sourceReference: eligibility.sourceReference,
      sourceExcerpt: eligibility.excerpt,
      owner: "authorization_staff",
      ...edges("payer-verification"),
      resolutionType: "human_review",
      resolutionAction:
        "Authorization staff to verify requirement with the payer",
      ...(verified(
        constraints.payerVerifiedBy,
        "Authorization staff verification"
      ) ?? {}),
    },
    {
      id: "lab-access",
      title: "Patient can reach the laboratory",
      description: labResolved
        ? "Saturday appointment accepted at Northside Laboratory."
        : "Central Laboratory is weekday 8–5 only; patient works 8–6.",
      category: "patient_constraint",
      status: labResolved ? "resolved" : labBlocked ? "blocked" : "pending",
      ...(labBlocked || labResolved
        ? fromMoss(labRule)
        : {
            sourceType: "deterministic_rule" as const,
            sourceReference: "Awaiting patient conversation",
          }),
      owner: "scheduler",
      ...edges("lab-access"),
      resolutionType: "schedule_appointment",
      resolutionAction: "Book Saturday slot at Northside Laboratory",
      ...(labResolved ? { resolvedAt: new Date().toISOString() } : {}),
    },
    {
      id: "dosing-comprehension",
      title: "Patient understands weekly dosing",
      description: dosingWrong
        ? "Patient stated daily. Plan specifies ONCE WEEKLY."
        : "Awaiting confirmation of dosing understanding.",
      category: "comprehension",
      status: dosingWrong ? "blocked" : "pending",
      ...(dosingWrong
        ? {
            sourceType: "deepgram" as const,
            sourceReference: "Patient conversation",
            sourceExcerpt: "Every day.",
          }
        : fromMoss(dosingRule)),
      owner: "clinician",
      ...edges("dosing-comprehension"),
      resolutionType: "patient_confirmation",
      resolutionAction:
        "Clinical team to re-confirm weekly dosing before first dose",
      ...(verified(
        constraints.dosingConfirmedBy,
        "Clinician re-confirmed dosing with patient"
      ) ?? {}),
    },
    {
      id: "safety-ack",
      title: "Teratogenicity counseling documented",
      description: "No acknowledgment on file for this patient.",
      category: "documentation",
      status: "blocked",
      ...fromMoss(safetyRule),
      owner: "clinician",
      ...edges("safety-ack"),
      resolutionType: "human_review",
      resolutionAction: "Clinician to complete and document counseling",
      ...(verified(
        constraints.safetyAckDocumentedBy,
        "Teratogenicity counseling documented"
      ) ?? {}),
    },
    {
      id: "baseline-labs",
      title: "Baseline CBC, hepatic panel, creatinine",
      description: `Order ${bundle.labs.id} is active; no results on file.`,
      category: "clinical",
      status: "pending",
      sourceType: "medplum",
      sourceReference: `ServiceRequest/${bundle.labs.id}`,
      owner: "patient",
      ...edges("baseline-labs"),
      resolutionType: "complete_test",
      resolutionAction: "Patient to complete baseline laboratory testing",
    },
    {
      id: "clinician-review",
      title: "Clinician reviews laboratory results",
      description: "Required before the first dose is taken.",
      category: "clinical",
      status: "pending",
      ...fromMoss(dosingRule),
      owner: "clinician",
      ...edges("clinician-review"),
      resolutionType: "human_review",
      resolutionAction: "Prescribing clinician to review and clear for start",
    },
    {
      id: "medication-start",
      title: "Begin methotrexate — once weekly",
      description: `MedicationRequest ${bundle.medication.id} is in draft.`,
      category: "clinical",
      status: "pending",
      sourceType: "medplum",
      sourceReference: `MedicationRequest/${bundle.medication.id}`,
      owner: "patient",
      ...edges("medication-start"),
      resolutionType: "none",
    },
    {
      id: "followup-scheduling",
      title: "Follow-up four weeks after treatment starts",
      description:
        "Cannot be dated until an actual medication start date exists.",
      category: "scheduling",
      status: "pending",
      sourceType: "deterministic_rule",
      sourceReference: "CarePlan dependency graph",
      owner: "scheduler",
      ...edges("followup-scheduling"),
      resolutionType: "schedule_appointment",
      resolutionAction: "Schedule once medication-start is resolved",
    },
  ];

  return { nodes: propagate(nodes), degraded };
}
