import { NextResponse } from "next/server";
import { loadCarePlanBundle } from "@/lib/medplum/read";
import { buildNodes } from "@/lib/preflight/build-nodes";
import { createTasksFromNodes, createProvenance, bookSaturdaySlot } from "@/lib/medplum/write";
import {
  summarize,
  type PatientConstraints,
  type PreflightResponse,
} from "@/lib/types";

export const dynamic = "force-dynamic";

type Body = {
  /** Current constraint state — the client owns this and sends it back. */
  constraints?: PatientConstraints;
  /** Set when resolving a specific node (e.g. booking the Saturday slot). */
  nodeId?: string;
  action?: string;
  /** Who performed a human verification. Recorded, never inferred. */
  verifiedBy?: string;
};

/**
 * POST /api/resolve
 *
 * Two jobs:
 *  1. Resolve a blocker — `{ nodeId: "lab-access", action: "schedule_appointment" }`
 *     books the Saturday slot in Medplum and flips the constraint.
 *  2. Override constraints — `{ constraints: { hasTransport: true } }`
 *     recomputes with changed reality. This is the "judge breaks it" path.
 */
export async function POST(req: Request): Promise<NextResponse> {
  const body: Body = await req.json();
  const constraints: PatientConstraints = { ...body.constraints };
  const degradedExtra: string[] = [];

  const bundle = await loadCarePlanBundle();

  if (body.nodeId === "lab-access" && body.action === "schedule_appointment") {
    if (!bundle.degraded) {
      try {
        await bookSaturdaySlot({
          patientId: bundle.patient.id!,
          slotId: bundle.saturdaySlot?.id,
        });
      } catch (err) {
        console.warn("[resolve] booking failed:", (err as Error).message);
        degradedExtra.push("appointment-booking");
      }
    }
    constraints.acceptsSaturdaySlot = true;
  }

  // Human verification events. These are the only route to `resolved` for the
  // clinical/payer nodes — a person did the work and is recorded as having
  // done it. Nothing here is inferred.
  if (body.action === "human_review" || body.action === "patient_confirmation") {
    const by = body.verifiedBy?.trim() || "clinic staff";
    if (body.nodeId === "payer-verification") constraints.payerVerifiedBy = by;
    if (body.nodeId === "safety-ack") constraints.safetyAckDocumentedBy = by;
    if (body.nodeId === "dosing-comprehension") constraints.dosingConfirmedBy = by;
    if (body.nodeId === "clinician-review") constraints.labResultsReviewedBy = by;
  }

  const { nodes, degraded } = await buildNodes(bundle, constraints);
  if (bundle.degraded) degraded.push("medplum");

  if (!bundle.degraded) {
    try {
      const taskIds = await createTasksFromNodes(nodes, {
        patientId: bundle.patient.id!,
        carePlanId: bundle.carePlan.id!,
      });
      await createProvenance(nodes, taskIds);
      for (const n of nodes) n.medplumTaskId = taskIds[n.id];
    } catch (err) {
      console.warn("[resolve] writeback failed:", (err as Error).message);
      degraded.push("medplum-writeback");
    }
  }

  const all = [...degraded, ...degradedExtra];
  const res: PreflightResponse = {
    nodes,
    summary: summarize(nodes),
    patientConstraints: constraints,
    ...(all.length ? { degraded: all } : {}),
  };

  return NextResponse.json(res);
}
