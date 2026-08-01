import { NextResponse } from "next/server";
import { loadCarePlanBundle } from "@/lib/medplum/read";
import { buildNodes } from "@/lib/preflight/build-nodes";
import { createTasksFromNodes, createProvenance } from "@/lib/medplum/write";
import { summarize, type PatientConstraints, type PreflightResponse } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/preflight?constraints=<urlencoded json>
 *
 * Runs the full compile: load Medplum → Stedi → Moss → assemble nodes →
 * write Tasks + Provenance → return.
 */
export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const raw = url.searchParams.get("constraints");
  const constraints: PatientConstraints = raw ? JSON.parse(raw) : {};
  const skipWrite = url.searchParams.get("skipWrite") === "1";

  const bundle = await loadCarePlanBundle();
  const { nodes, degraded } = await buildNodes(bundle, constraints);
  if (bundle.degraded) degraded.push("medplum");

  if (!skipWrite && !bundle.degraded) {
    try {
      const taskIds = await createTasksFromNodes(nodes);
      await createProvenance(nodes, taskIds);
      for (const n of nodes) n.medplumTaskId = taskIds[n.id];
    } catch (err) {
      console.warn("[preflight] writeback failed:", (err as Error).message);
      degraded.push("medplum-writeback");
    }
  }

  const body: PreflightResponse = {
    nodes,
    summary: summarize(nodes),
    patientConstraints: constraints,
    ...(degraded.length ? { degraded } : {}),
  };

  return NextResponse.json(body);
}
