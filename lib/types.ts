// ⚠️ FROZEN CONTRACT — agreed by A and B at 9:30.
// Changing anything in this file is a stop-both-people event.

export const NODE_IDS = [
  "payer-verification",
  "baseline-labs",
  "lab-access",
  "dosing-comprehension",
  "safety-ack",
  "clinician-review",
  "medication-start",
  "followup-scheduling",
] as const;

export type NodeId = (typeof NODE_IDS)[number];

export type NodeStatus =
  | "pass"
  | "blocked"
  | "needs_human_verification"
  | "pending"
  | "resolved";

export type SourceType =
  | "medplum"
  | "stedi"
  | "moss"
  | "deepgram"
  | "deterministic_rule";

export type Owner =
  | "patient"
  | "clinician"
  | "authorization_staff"
  | "scheduler"
  | "system";

export type NodeCategory =
  | "clinical"
  | "payer"
  | "patient_constraint"
  | "comprehension"
  | "scheduling"
  | "documentation";

export type ResolutionType =
  | "human_review"
  | "patient_confirmation"
  | "schedule_appointment"
  | "retrieve_document"
  | "complete_test"
  | "none";

export type PreflightNode = {
  id: NodeId;
  title: string;
  description: string;
  category: NodeCategory;
  status: NodeStatus;

  /** Where this status came from. Every blocker must be attributable. */
  sourceType: SourceType;
  sourceReference: string;
  sourceExcerpt?: string;
  /** Moss only — rendered as a badge on screen. */
  retrievalLatencyMs?: number;

  owner: Owner;
  dependsOn: NodeId[];
  blocks: NodeId[];

  resolutionType: ResolutionType;
  resolutionAction?: string;
  resolvedAt?: string;

  /** Set by A after Medplum writeback. */
  medplumTaskId?: string;
};

/**
 * Structural shape of the graph. Part of the frozen contract because BOTH
 * sides need it: A emits nodes carrying these edges, B propagates over them.
 * B's engine owns the propagation LOGIC; this is just the wiring.
 */
export const DEPENDENCIES: Record<NodeId, NodeId[]> = {
  "payer-verification": [],
  "lab-access": [],
  "safety-ack": [],
  "dosing-comprehension": [],
  "baseline-labs": ["lab-access"],
  "clinician-review": ["baseline-labs"],
  "medication-start": [
    "payer-verification",
    "clinician-review",
    "dosing-comprehension",
    "safety-ack",
  ],
  "followup-scheduling": ["medication-start"],
};

/** Inverse of DEPENDENCIES. */
export const BLOCKS: Record<NodeId, NodeId[]> = NODE_IDS.reduce((acc, id) => {
  acc[id] = NODE_IDS.filter((other) => DEPENDENCIES[other].includes(id));
  return acc;
}, {} as Record<NodeId, NodeId[]>);

/** Graph is fixed, so topological order is a constant — no sort needed. */
export const TOPO_ORDER: NodeId[] = [
  "payer-verification",
  "lab-access",
  "safety-ack",
  "dosing-comprehension",
  "baseline-labs",
  "clinician-review",
  "medication-start",
  "followup-scheduling",
];

export type PatientConstraints = {
  believedDosingFrequency?: "daily" | "weekly" | "unknown";
  weekdayLabAvailable?: boolean;
  acceptsSaturdaySlot?: boolean;
  readbackConfirmed?: boolean;
  hasTransport?: boolean;
};

export type PreflightSummary = {
  passed: number;
  blocked: number;
  needsVerification: number;
  pending: number;
  buildPassing: boolean;
};

export type PreflightResponse = {
  nodes: PreflightNode[];
  summary: PreflightSummary;
  patientConstraints: PatientConstraints;
  /** Present when running off mock/fallback data. Shown as a badge. */
  degraded?: string[];
};

export type ResolveRequest = {
  nodeId: NodeId;
  action: ResolutionType;
  payload?: Record<string, unknown>;
};

export type OverrideRequest = {
  constraints: Partial<PatientConstraints>;
};

/**
 * Pure structural propagation over DEPENDENCIES.
 *
 * ⚠️ SAFETY INVARIANT: propagation only ever DEMOTES. A node reaches `pass` or
 * `resolved` solely through evidence — structured data, explicit patient
 * confirmation, or human verification — never because its upstream happens to
 * be clear. "Nothing is blocking it" is not the same as "it has been done".
 *
 * So the only transition here is: a node someone marked `pass` whose upstream
 * is unfinished gets demoted to `pending`. Everything else is left alone.
 *
 * Lives in the contract because it's derived entirely from DEPENDENCIES — no
 * judgement in it. B's `recompute(nodes, constraints)` should apply constraint
 * interpretation and then call this, rather than reimplementing it.
 */
export function propagate(nodes: PreflightNode[]): PreflightNode[] {
  const byId = new Map(nodes.map((n) => [n.id, { ...n }]));

  for (const id of TOPO_ORDER) {
    const node = byId.get(id);
    if (!node) continue;
    if (node.status !== "pass") continue;

    const waiting = DEPENDENCIES[id].some((dep) => {
      const s = byId.get(dep)?.status;
      return s !== "pass" && s !== "resolved";
    });
    if (waiting) node.status = "pending";
  }

  return TOPO_ORDER.map((id) => byId.get(id)!).filter(Boolean);
}

export function summarize(nodes: PreflightNode[]): PreflightSummary {
  const count = (s: NodeStatus) => nodes.filter((n) => n.status === s).length;
  const passed = count("pass") + count("resolved");
  const blocked = count("blocked");
  const needsVerification = count("needs_human_verification");
  return {
    passed,
    blocked,
    needsVerification,
    pending: count("pending"),
    buildPassing: blocked === 0 && needsVerification === 0,
  };
}
