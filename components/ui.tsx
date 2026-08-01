"use client";

import type { NodeStatus, PreflightNode } from "@/lib/types";

export const STATUS_STYLE: Record<
  NodeStatus,
  { label: string; dot: string; text: string; border: string; bg: string }
> = {
  blocked: {
    label: "BLOCKED",
    dot: "bg-red-500",
    text: "text-red-400",
    border: "border-red-500/40",
    bg: "bg-red-500/5",
  },
  needs_human_verification: {
    label: "NEEDS REVIEW",
    dot: "bg-amber-500",
    text: "text-amber-400",
    border: "border-amber-500/40",
    bg: "bg-amber-500/5",
  },
  pending: {
    label: "WAITING",
    dot: "bg-zinc-600",
    text: "text-zinc-500",
    border: "border-zinc-800",
    bg: "bg-transparent",
  },
  pass: {
    label: "PASS",
    dot: "bg-emerald-500",
    text: "text-emerald-400",
    border: "border-emerald-500/40",
    bg: "bg-emerald-500/5",
  },
  resolved: {
    label: "RESOLVED",
    dot: "bg-emerald-500",
    text: "text-emerald-400",
    border: "border-emerald-500/40",
    bg: "bg-emerald-500/5",
  },
};

export function StatusPill({ status }: { status: NodeStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wider ${s.border} ${s.text}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

const OWNER_LABEL: Record<string, string> = {
  patient: "Patient",
  clinician: "Clinician",
  authorization_staff: "Authorization staff",
  scheduler: "Scheduler",
  system: "System",
};

export function BlockerCard({
  node,
  onResolve,
  busy,
}: {
  node: PreflightNode;
  onResolve?: () => void;
  busy?: boolean;
}) {
  const s = STATUS_STYLE[node.status];
  const canResolve =
    onResolve &&
    node.status === "blocked" &&
    node.resolutionType === "schedule_appointment";

  return (
    <div
      className={`rounded-lg border p-4 transition-all duration-300 ${s.border} ${s.bg}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-zinc-100">{node.title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">
            {node.description}
          </p>
        </div>
        <StatusPill status={node.status} />
      </div>

      {node.sourceExcerpt && (
        <figure className="mt-3 border-l-2 border-zinc-700 pl-3">
          <blockquote className="text-xs italic leading-relaxed text-zinc-400">
            &ldquo;{node.sourceExcerpt}&rdquo;
          </blockquote>
          <figcaption className="mt-1.5 flex items-center gap-2 font-mono text-[10px] text-zinc-600">
            <span>{node.sourceReference}</span>
            {node.retrievalLatencyMs !== undefined && (
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-emerald-500">
                {node.retrievalLatencyMs}ms
              </span>
            )}
          </figcaption>
        </figure>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[10px] text-zinc-600">
        <span>OWNER · {OWNER_LABEL[node.owner] ?? node.owner}</span>
        {node.blocks.length > 0 && <span>BLOCKS · {node.blocks.join(", ")}</span>}
        {node.medplumTaskId && (
          <span className="text-zinc-700">Task/{node.medplumTaskId.slice(0, 8)}</span>
        )}
      </div>

      {node.resolutionAction && node.status !== "resolved" && (
        <p className="mt-2 text-xs text-zinc-500">→ {node.resolutionAction}</p>
      )}

      {canResolve && (
        <button
          onClick={onResolve}
          disabled={busy}
          className="mt-3 rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 font-mono text-[11px] tracking-wide text-emerald-400 transition hover:bg-emerald-500/20 disabled:opacity-40"
        >
          {busy ? "BOOKING…" : "BOOK SATURDAY SLOT"}
        </button>
      )}
    </div>
  );
}

/** Fixed-layout dependency graph. 8 nodes, hand-positioned — no library. */
export function GraphView({ nodes }: { nodes: PreflightNode[] }) {
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));

  const Node = ({ id, label }: { id: string; label: string }) => {
    const n = byId[id];
    if (!n) return null;
    const s = STATUS_STYLE[n.status];
    return (
      <div
        className={`rounded border px-2.5 py-2 text-center transition-all duration-500 ${s.border} ${s.bg}`}
      >
        <div className={`h-1 w-1 rounded-full ${s.dot} mx-auto mb-1.5`} />
        <div className="font-mono text-[9px] leading-tight text-zinc-400">
          {label}
        </div>
      </div>
    );
  };

  const Arrow = () => (
    <div className="flex items-center justify-center text-zinc-700">
      <svg width="16" height="8" viewBox="0 0 16 8" fill="none">
        <path d="M0 4h13m0 0l-3-3m3 3l-3 3" stroke="currentColor" strokeWidth="1" />
      </svg>
    </div>
  );

  return (
    <div className="rounded-lg border border-zinc-800 p-5">
      <div className="mb-4 font-mono text-[10px] tracking-wider text-zinc-600">
        DEPENDENCY GRAPH
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] items-center gap-2">
          <Node id="lab-access" label="lab access" />
          <Arrow />
          <Node id="baseline-labs" label="baseline labs" />
          <Arrow />
          <Node id="clinician-review" label="clinician review" />
          <Arrow />
          <Node id="medication-start" label="start medication" />
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] items-center gap-2">
          <Node id="payer-verification" label="payer auth" />
          <div />
          <Node id="dosing-comprehension" label="dosing understood" />
          <div />
          <Node id="safety-ack" label="safety ack" />
          <Arrow />
          <Node id="followup-scheduling" label="4-week follow-up" />
        </div>
      </div>

      <p className="mt-4 font-mono text-[9px] leading-relaxed text-zinc-700">
        payer auth · dosing understood · safety ack all gate start medication
      </p>
    </div>
  );
}
