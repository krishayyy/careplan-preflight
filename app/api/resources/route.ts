import { NextResponse } from "next/server";
import { getMedplum, SEED_TAG } from "@/lib/medplum/client";

export const dynamic = "force-dynamic";

export type ResourceRow = {
  resourceType: string;
  id: string;
  summary: string;
  detail?: string;
  status?: string;
  partOf?: string[];
};

export type ResourcesResponse = {
  rows: ResourceRow[];
  degraded?: string;
};

/**
 * GET /api/resources
 *
 * Reads back what Preflight actually wrote to Medplum — the Task chain, the
 * Provenance trail, and the booked Appointment. This is the proof screen: it
 * shows the product isn't a frontend mockup over hardcoded state.
 */
export async function GET(): Promise<NextResponse> {
  if (!process.env.MEDPLUM_CLIENT_ID || !process.env.SEED_PATIENT_ID) {
    return NextResponse.json({
      rows: [],
      degraded: "Medplum not configured — showing no live resources.",
    } satisfies ResourcesResponse);
  }

  try {
    const medplum = await getMedplum();
    const tag = `${SEED_TAG.system}|${SEED_TAG.code}`;
    const rows: ResourceRow[] = [];

    const carePlan = await medplum.readResource(
      "CarePlan",
      process.env.SEED_CAREPLAN_ID!
    );
    rows.push({
      resourceType: "CarePlan",
      id: carePlan.id!,
      summary: carePlan.title ?? "Care plan",
      status: carePlan.status,
    });

    const tasks = await medplum.searchResources("Task", { _tag: tag, _count: 50 });
    for (const t of tasks) {
      rows.push({
        resourceType: "Task",
        id: t.id!,
        summary: t.description ?? "Task",
        detail: t.owner?.display,
        status: t.businessStatus?.text ?? t.status,
        partOf: t.partOf?.map((p) => p.reference ?? "").filter(Boolean),
      });
    }

    const provenance = await medplum.searchResources("Provenance", {
      _tag: tag,
      _count: 50,
    });
    for (const p of provenance) {
      rows.push({
        resourceType: "Provenance",
        id: p.id!,
        summary: `→ ${p.target?.[0]?.reference ?? "unknown target"}`,
        detail: p.entity?.[0]?.what?.reference ?? p.agent?.[0]?.type?.text,
      });
    }

    const appointments = await medplum.searchResources("Appointment", {
      _tag: tag,
      _count: 10,
    });
    for (const a of appointments) {
      rows.push({
        resourceType: "Appointment",
        id: a.id!,
        summary: a.description ?? "Appointment",
        detail: a.start,
        status: a.status,
      });
    }

    return NextResponse.json({ rows } satisfies ResourcesResponse);
  } catch (err) {
    return NextResponse.json({
      rows: [],
      degraded: (err as Error).message,
    } satisfies ResourcesResponse);
  }
}
