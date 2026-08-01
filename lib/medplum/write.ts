import { getMedplum, SEED_TAG } from "./client";
import { TOPO_ORDER, type NodeId, type PreflightNode } from "../types";
import type { Task, Provenance, Appointment, Slot } from "@medplum/fhirtypes";

const TAG = { meta: { tag: [SEED_TAG] } };

function taskStatus(node: PreflightNode): Task["status"] {
  switch (node.status) {
    case "blocked":
      return "on-hold";
    case "needs_human_verification":
      return "requested";
    case "resolved":
    case "pass":
      return "completed";
    default:
      return "draft";
  }
}

/**
 * Writes one Task per node, in topological order — `partOf` references
 * dependency Tasks, so they must already exist. Returns nodeId → Task id.
 */
export async function createTasksFromNodes(
  nodes: PreflightNode[],
  ids: { patientId: string; carePlanId: string }
): Promise<Record<string, string>> {
  const medplum = await getMedplum();
  const { patientId, carePlanId } = ids;

  // Clear the previous run so repeated demos don't accumulate. Provenance must
  // go too — it targets Tasks by reference, so leaving it behind orphans it and
  // the count climbs every time you re-run the demo.
  const tag = `${SEED_TAG.system}|${SEED_TAG.code}`;

  const staleProvenance = await medplum.searchResources("Provenance", {
    _tag: tag,
    _count: 100,
  });
  for (const p of staleProvenance) {
    if (p.id) await medplum.deleteResource("Provenance", p.id);
  }

  const stale = await medplum.searchResources("Task", { _tag: tag, _count: 100 });
  for (const t of stale) {
    if (t.id) await medplum.deleteResource("Task", t.id);
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const taskIds: Record<string, string> = {};

  for (const id of TOPO_ORDER) {
    const node = byId.get(id as NodeId);
    if (!node) continue;

    const created = await medplum.createResource<Task>({
      resourceType: "Task",
      ...TAG,
      status: taskStatus(node),
      intent: "order",
      priority: "routine",
      description: node.title,
      for: { reference: `Patient/${patientId}` },
      focus: { reference: `CarePlan/${carePlanId}` },
      owner: { display: node.owner },
      businessStatus: { text: node.status },
      note: node.resolutionAction ? [{ text: node.resolutionAction }] : undefined,
      partOf: node.dependsOn
        .map((dep) => taskIds[dep])
        .filter(Boolean)
        .map((tid) => ({ reference: `Task/${tid}` })),
    });

    taskIds[node.id] = created.id!;
  }

  return taskIds;
}

/**
 * One Provenance per blocker, pointing at the DocumentReference that triggered
 * it. This is the citation trail — it's what makes "every blocker cites its
 * source" true in FHIR rather than just true in the UI.
 */
export async function createProvenance(
  nodes: PreflightNode[],
  taskIds: Record<string, string>
): Promise<void> {
  const medplum = await getMedplum();

  // Discover the rule DocumentReferences by their identifier rather than
  // relying on a SEED_DOC_IDS blob being pasted into the environment.
  const docIds: Record<string, string> = JSON.parse(
    process.env.SEED_DOC_IDS ?? "{}"
  );
  if (Object.keys(docIds).length === 0) {
    const docs = await medplum.searchResources("DocumentReference", {
      _tag: `${SEED_TAG.system}|${SEED_TAG.code}`,
      _count: 20,
    });
    for (const d of docs) {
      const rid = d.identifier?.find(
        (i) => i.system === "https://careplan-preflight.dev/rule"
      )?.value;
      if (rid && d.id) docIds[rid] = d.id;
    }
  }

  const attributable = nodes.filter(
    (n) => n.status === "blocked" || n.status === "needs_human_verification"
  );

  for (const node of attributable) {
    const taskId = taskIds[node.id];
    if (!taskId) continue;

    // Match the retrieved doc back to its DocumentReference when we have one.
    const ruleId = Object.keys(docIds).find((rid) =>
      node.sourceReference.toLowerCase().includes(rid.split("-")[0])
    );

    await medplum.createResource<Provenance>({
      resourceType: "Provenance",
      ...TAG,
      target: [{ reference: `Task/${taskId}` }],
      recorded: new Date().toISOString(),
      agent: [
        {
          who: { display: "CarePlan Preflight" },
          type: { text: node.sourceType },
        },
      ],
      entity:
        ruleId && docIds[ruleId]
          ? [
              {
                role: "source",
                what: { reference: `DocumentReference/${docIds[ruleId]}` },
              },
            ]
          : undefined,
    });
  }
}

/** Books the seeded Saturday slot. Falls back to a plain Appointment. */
export async function bookSaturdaySlot(ids: {
  patientId: string;
  slotId?: string;
}): Promise<Appointment> {
  const medplum = await getMedplum();
  const { patientId } = ids;

  let slotId = ids.slotId ?? process.env.SEED_SATURDAY_SLOT_ID;
  if (!slotId) {
    const free = await medplum.searchResources("Slot", {
      _tag: `${SEED_TAG.system}|${SEED_TAG.code}`,
      status: "free",
      _count: 1,
    });
    slotId = free[0]?.id;
  }
  if (!slotId) throw new Error("no free Slot to book — run scripts/seed.ts");

  const slot = await medplum.readResource("Slot", slotId);

  const appointment = await medplum.createResource<Appointment>({
    resourceType: "Appointment",
    ...TAG,
    status: "booked",
    slot: [{ reference: `Slot/${slotId}` }],
    start: slot.start,
    end: slot.end,
    description: "Baseline laboratory draw — Northside Laboratory",
    participant: [
      {
        actor: { reference: `Patient/${patientId}` },
        status: "accepted",
      },
    ],
  });

  await medplum.updateResource<Slot>({ ...slot, status: "busy" } as Slot);
  return appointment;
}
