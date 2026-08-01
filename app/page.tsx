"use client";

import { useState } from "react";
import { usePreflight } from "@/lib/usePreflight";
import { BlockerCard, GraphView, StatusPill } from "@/components/ui";
import { MedplumProof, Readback } from "@/components/proof";
import { Conversation } from "@/components/conversation";
import type { NodeId, PatientConstraints } from "@/lib/types";

type Phase =
  | "plan"
  | "compiling"
  | "conversation"
  | "results"
  | "readback"
  | "proof";

const COMPILE_STEPS = [
  "Reading Medplum CarePlan",
  "Building dependency graph",
  "Checking payer eligibility (Stedi 270/271)",
  "Retrieving clinical rules (Moss)",
  "Checking scheduling availability",
  "Preparing patient questions",
];

export default function Home() {
  const [phase, setPhase] = useState<Phase>("plan");
  const [step, setStep] = useState(0);
  const [local, setLocal] = useState<PatientConstraints>({});
  const pf = usePreflight();

  async function startPreflight() {
    setPhase("compiling");
    setStep(0);
    for (let i = 0; i < COMPILE_STEPS.length; i++) {
      setStep(i + 1);
      await new Promise((r) => setTimeout(r, 240));
    }
    await pf.run({});
    setPhase("conversation");
  }

  function resetAll() {
    pf.reset();
    setLocal({});
    setStep(0);
    setPhase("plan");
  }

  const failed = pf.nodes.length > 0 && !pf.summary.buildPassing;

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="border-b border-zinc-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-sm tracking-widest">FLUFFY</span>
            <span className="text-xs text-zinc-600">CarePlan Preflight</span>
          </div>
          <div className="flex items-center gap-3">
            {pf.degraded.length > 0 && (
              <span className="rounded border border-amber-500/30 px-2 py-0.5 font-mono text-[10px] text-amber-500/80">
                CACHED: {pf.degraded.join(" · ")}
              </span>
            )}
            <button
              onClick={resetAll}
              className="font-mono text-[10px] tracking-wider text-zinc-600 transition hover:text-zinc-400"
            >
              RESET
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-10">
        {phase === "plan" && (
          <div className="mx-auto max-w-2xl">
            <div className="rounded-lg border border-zinc-800 p-6">
              <div className="flex items-baseline justify-between">
                <h1 className="text-lg font-medium">Maya Thompson</h1>
                <span className="font-mono text-[11px] text-zinc-600">
                  34 · F · 1992-03-14
                </span>
              </div>
              <p className="mt-1 text-sm text-zinc-500">
                Plaque psoriasis — methotrexate initiation
              </p>

              <div className="mt-6 space-y-3 border-t border-zinc-900 pt-5">
                {[
                  ["Medication", "Methotrexate 15 mg oral — once weekly"],
                  ["Laboratory", "Baseline CBC, hepatic panel, serum creatinine"],
                  ["Follow-up", "Return in four weeks"],
                ].map(([k, v]) => (
                  <div key={k} className="flex gap-6">
                    <span className="w-24 shrink-0 font-mono text-[10px] uppercase tracking-wider text-zinc-600">
                      {k}
                    </span>
                    <span className="text-sm text-zinc-300">{v}</span>
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={startPreflight}
              className="mt-6 w-full rounded-lg border border-zinc-700 bg-zinc-900 py-3 font-mono text-xs tracking-widest transition hover:border-zinc-600 hover:bg-zinc-800"
            >
              RUN PREFLIGHT
            </button>
            <p className="mt-3 text-center text-xs text-zinc-600">
              Clinically correct. Now check whether the patient can actually run it.
            </p>
          </div>
        )}

        {phase === "compiling" && (
          <div className="mx-auto max-w-md space-y-2 pt-10">
            {COMPILE_STEPS.map((s, i) => (
              <div
                key={s}
                className={`flex items-center gap-3 font-mono text-xs transition ${
                  i < step ? "text-zinc-300" : "text-zinc-700"
                }`}
              >
                <span className={i < step ? "text-emerald-500" : ""}>
                  {i < step ? "✓" : "·"}
                </span>
                {s}
              </div>
            ))}
          </div>
        )}

        {phase === "conversation" && (
          <Conversation
            busy={pf.busy}
            onConstraints={async (patch) => {
              const next = { ...local, ...patch };
              setLocal(next);
              await pf.run(next);
            }}
            onDone={() => setPhase("results")}
          />
        )}


        {phase === "results" && (
          <div className="space-y-6">
            <div
              className={`rounded-lg border p-6 transition-all duration-500 ${
                failed
                  ? "border-red-500/40 bg-red-500/5"
                  : "border-emerald-500/40 bg-emerald-500/5"
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`font-mono text-xl ${
                    failed ? "text-red-500" : "text-emerald-500"
                  }`}
                >
                  {failed ? "✕" : "✓"}
                </span>
                <h2
                  className={`font-mono text-lg tracking-wider ${
                    failed ? "text-red-400" : "text-emerald-400"
                  }`}
                >
                  {failed ? "PREFLIGHT FAILED" : "PREFLIGHT PASSED"}
                </h2>
              </div>
              <p className="mt-2 font-mono text-xs text-zinc-500">
                {pf.summary.passed} passed · {pf.summary.blocked} blocked ·{" "}
                {pf.summary.needsVerification} needs review · {pf.summary.pending}{" "}
                waiting
              </p>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
              <div className="space-y-3">
                {pf.nodes
                  .filter(
                    (n) =>
                      n.status === "blocked" ||
                      n.status === "needs_human_verification" ||
                      n.status === "resolved"
                  )
                  .map((n) => (
                    <BlockerCard
                      key={n.id}
                      node={n}
                      busy={pf.busy}
                      onResolve={() =>
                        pf.resolve(n.id as NodeId, n.resolutionType)
                      }
                    />
                  ))}
              </div>

              <div className="space-y-5">
                <GraphView nodes={pf.nodes} />

                <div className="rounded-lg border border-zinc-800 p-5">
                  <div className="mb-3 font-mono text-[10px] tracking-wider text-zinc-600">
                    CHANGE THE FACTS
                  </div>
                  <div className="space-y-2">
                    {(
                      [
                        ["Patient has a car", { hasTransport: true }],
                        ["Weekday lab works", { weekdayLabAvailable: true }],
                        [
                          "Dosing understood",
                          { believedDosingFrequency: "weekly" },
                        ],
                      ] as [string, Partial<PatientConstraints>][]
                    ).map(([label, patch]) => (
                      <button
                        key={label}
                        onClick={() => pf.override(patch)}
                        disabled={pf.busy}
                        className="w-full rounded border border-zinc-800 px-3 py-2 text-left font-mono text-[11px] text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-200 disabled:opacity-40"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-[10px] leading-relaxed text-zinc-700">
                    Recomputes against live Medplum, Stedi and Moss.
                  </p>
                </div>

                <div className="rounded-lg border border-zinc-800 p-5">
                  <div className="mb-3 font-mono text-[10px] tracking-wider text-zinc-600">
                    ALL CHECKS
                  </div>
                  <div className="space-y-2">
                    {pf.nodes.map((n) => (
                      <div
                        key={n.id}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="font-mono text-[10px] text-zinc-500">
                          {n.id}
                        </span>
                        <StatusPill status={n.status} />
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  onClick={() => setPhase("readback")}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 py-3 font-mono text-[11px] tracking-widest transition hover:border-zinc-600 hover:bg-zinc-800"
                >
                  READ PLAN BACK TO PATIENT →
                </button>
              </div>
            </div>
          </div>
        )}

        {phase === "readback" && (
          <Readback
            nodes={pf.nodes}
            busy={pf.busy}
            onConfirm={() => setPhase("proof")}
          />
        )}

        {phase === "proof" && (
          <div className="space-y-6">
            <MedplumProof />

            <div className="rounded-lg border border-zinc-800 p-8 text-center">
              <p className="text-sm leading-relaxed text-zinc-400">
                Care plans are written as lists.
                <br />
                Patients experience them as dependency graphs.
              </p>
              <p className="mt-5 font-mono text-xs tracking-wide text-zinc-100">
                We fail the build when the patient can&rsquo;t run it.
              </p>
              <button
                onClick={resetAll}
                className="mt-8 font-mono text-[10px] tracking-wider text-zinc-600 transition hover:text-zinc-400"
              >
                RUN AGAIN
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
