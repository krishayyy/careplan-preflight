"use client";

import { useEffect, useState } from "react";
import type { ResourceRow, ResourcesResponse } from "@/app/api/resources/route";
import type { NodeId, PreflightNode } from "@/lib/types";

const TYPE_COLOR: Record<string, string> = {
  CarePlan: "text-zinc-300",
  Task: "text-amber-400",
  Provenance: "text-sky-400",
  Appointment: "text-emerald-400",
};

/**
 * Screen 7 — reads back what actually landed in Medplum. The point is to prove
 * the Task chain and Provenance trail are real FHIR, not UI state.
 */
export function MedplumProof() {
  const [data, setData] = useState<ResourcesResponse | null>(null);

  useEffect(() => {
    fetch("/api/resources")
      .then((r) => r.json())
      .then(setData)
      .catch((e) => setData({ rows: [], degraded: String(e) }));
  }, []);

  const grouped = (data?.rows ?? []).reduce<Record<string, ResourceRow[]>>(
    (acc, row) => {
      (acc[row.resourceType] ??= []).push(row);
      return acc;
    },
    {}
  );

  return (
    <div className="rounded-lg border border-zinc-800 p-6">
      <div className="mb-1 font-mono text-[10px] tracking-wider text-zinc-600">
        WRITTEN TO MEDPLUM
      </div>
      <p className="mb-5 text-xs text-zinc-600">
        Live FHIR resources — not application state.
      </p>

      {!data && <p className="font-mono text-xs text-zinc-600">loading…</p>}

      {data?.degraded && (
        <div className="rounded border border-amber-500/30 bg-amber-500/5 p-3 font-mono text-[10px] leading-relaxed text-amber-500/80">
          {data.degraded}
        </div>
      )}

      {data && data.rows.length > 0 && (
        <div className="space-y-5">
          {Object.entries(grouped).map(([type, rows]) => (
            <div key={type}>
              <div
                className={`mb-2 font-mono text-[10px] tracking-wider ${
                  TYPE_COLOR[type] ?? "text-zinc-400"
                }`}
              >
                {type} · {rows.length}
              </div>
              <div className="space-y-1.5">
                {rows.map((r) => (
                  <div
                    key={r.id}
                    className="rounded border border-zinc-900 bg-zinc-900/40 px-3 py-2"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-xs text-zinc-300">{r.summary}</span>
                      <span className="shrink-0 font-mono text-[9px] text-zinc-700">
                        {r.id.slice(0, 8)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-[9px] text-zinc-600">
                      {r.status && <span>{r.status}</span>}
                      {r.detail && <span>{r.detail}</span>}
                      {r.partOf && r.partOf.length > 0 && (
                        <span className="text-zinc-700">
                          partOf · {r.partOf.length}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The plain-language plan read back to the patient before they leave.
 *
 * Lines are derived from actual node status — never assert the appointment is
 * booked when it isn't. Telling a patient their lab is scheduled when nothing
 * was scheduled is exactly the failure mode this product exists to catch.
 */
export function Readback({
  nodes,
  onConfirm,
  busy,
}: {
  nodes: PreflightNode[];
  onConfirm: () => void;
  busy?: boolean;
}) {
  const status = (id: NodeId) => nodes.find((n) => n.id === id)?.status;

  const lines = [
    status("lab-access") === "resolved"
      ? "Your laboratory visit is booked for Saturday at 10:00 AM at Northside Laboratory."
      : "We have not yet found a laboratory appointment you can attend. The clinic will contact you to arrange one.",

    status("payer-verification") === "needs_human_verification"
      ? "The clinic is checking whether your insurance requires an additional approval."
      : "Your insurance coverage has been confirmed for this medication.",

    "Do not begin the medication until your clinician reviews your laboratory results and confirms you should start.",

    status("dosing-comprehension") === "blocked"
      ? "The proposed schedule is once weekly — not daily. Your care team will confirm this with you directly."
      : "The proposed schedule is once weekly.",

    "Your follow-up will be scheduled four weeks after you actually begin treatment.",
  ];

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-lg border border-zinc-800 p-6">
        <div className="mb-5 flex items-center gap-2 font-mono text-[10px] tracking-wider text-zinc-600">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
          READING PLAN BACK TO PATIENT
        </div>

        <ol className="space-y-4">
          {lines.map((l, i) => (
            <li key={i} className="flex gap-4">
              <span className="font-mono text-[10px] text-zinc-700">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-sm leading-relaxed text-zinc-300">{l}</span>
            </li>
          ))}
        </ol>

        <p className="mt-6 border-t border-zinc-900 pt-4 text-xs text-zinc-600">
          Automated assistant. Clinical decisions remain with your care team.
        </p>
      </div>

      <button
        onClick={onConfirm}
        disabled={busy}
        className="mt-6 w-full rounded-lg border border-zinc-700 bg-zinc-900 py-3 font-mono text-xs tracking-widest transition hover:border-zinc-600 hover:bg-zinc-800 disabled:opacity-40"
      >
        PATIENT CONFIRMS UNDERSTANDING
      </button>
    </div>
  );
}
