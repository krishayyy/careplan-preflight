"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLiveTranscript, speak } from "@/lib/deepgram/live";
import {
  extractConstraints,
  describeExtraction,
  type TurnIntent,
} from "@/lib/deepgram/extract";
import type { PatientConstraints } from "@/lib/types";

export type Turn = {
  agent: string;
  intent?: TurnIntent;
  /** Used only in scripted mode. */
  scriptedPatient?: string;
  scriptedSets?: Partial<PatientConstraints>;
  retrieval?: { doc: string; excerpt: string; ms: number };
};

export const TURNS: Turn[] = [
  {
    agent:
      "Before your treatment begins I need to confirm a few practical details. How often do you think you'll take this medication?",
    intent: "dosing_frequency",
    scriptedPatient: "Every day, with breakfast.",
    scriptedSets: { believedDosingFrequency: "daily" },
    retrieval: {
      doc: "Methotrexate Initiation Protocol",
      excerpt:
        "Methotrexate for plaque psoriasis is dosed ONCE WEEKLY. Daily administration is a known fatal medication error.",
      ms: 6,
    },
  },
  {
    agent:
      "The plan your clinician recorded says once weekly, not daily. I'll flag this for the clinical team to confirm with you before treatment begins.",
  },
  {
    agent:
      "Would you be able to complete laboratory testing on a weekday between eight and five?",
    intent: "weekday_lab",
    scriptedPatient: "No — I work eight to six.",
    scriptedSets: { weekdayLabAvailable: false },
    retrieval: {
      doc: "Northside Laboratory Hours",
      excerpt:
        "Saturday appointments available 8:00 AM to 12:00 PM for patients unable to attend weekday hours.",
      ms: 7,
    },
  },
];

export function Conversation({
  onConstraints,
  onDone,
  busy,
}: {
  onConstraints: (patch: Partial<PatientConstraints>) => Promise<void>;
  onDone: () => void;
  busy?: boolean;
}) {
  const [turn, setTurn] = useState(0);
  const [live, setLive] = useState(false);
  const [heard, setHeard] = useState<string>("");
  const [understood, setUnderstood] = useState<
    Partial<PatientConstraints> | null
  >(null);
  const [status, setStatus] = useState<string>("");
  const dg = useLiveTranscript();
  const spokenFor = useRef<number>(-1);

  const t = TURNS[turn];

  // Probe once so the toggle only appears when Deepgram is actually reachable.
  useEffect(() => {
    fetch("/api/deepgram/key")
      .then((r) => r.json())
      .then((r) => setLive(Boolean(r.enabled)))
      .catch(() => setLive(false));
  }, []);

  // Speak each agent line once when it appears, in live mode.
  useEffect(() => {
    if (!live || spokenFor.current === turn) return;
    spokenFor.current = turn;
    speak(t.agent);
  }, [live, turn, t.agent]);

  const commit = useCallback(
    async (patch: Partial<PatientConstraints> | null) => {
      if (patch) await onConstraints(patch);
      if (turn + 1 >= TURNS.length) onDone();
      else {
        setTurn(turn + 1);
        setHeard("");
        setUnderstood(null);
        setStatus("");
      }
    },
    [turn, onConstraints, onDone]
  );

  /** Live: listen, then extract from what was actually said. */
  const listen = useCallback(async () => {
    setStatus("listening…");
    const started = await dg.start();
    if (!started) {
      setStatus("microphone unavailable — using scripted answer");
      setLive(false);
      return;
    }
  }, [dg]);

  const stopAndExtract = useCallback(async () => {
    dg.stop();
    const text = dg.transcript.trim();
    setHeard(text);

    if (!t.intent) return commit(null);

    const patch = extractConstraints(text, t.intent);
    setUnderstood(patch);

    if (!patch) {
      setStatus("Didn't catch that — try again.");
      return;
    }
    setStatus("");
    await commit(patch);
  }, [dg, t.intent, commit]);

  const scriptedNext = useCallback(
    () => commit(t.scriptedSets ?? null),
    [commit, t.scriptedSets]
  );

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      {/* transcript */}
      <div className="rounded-lg border border-zinc-800 p-5">
        <div className="mb-4 flex items-center justify-between">
          <span className="font-mono text-[10px] tracking-wider text-zinc-600">
            TRANSCRIPT
          </span>
          <span
            className={`font-mono text-[9px] tracking-wider ${
              live ? "text-emerald-500" : "text-zinc-700"
            }`}
          >
            {live ? "● LIVE VOICE" : "SCRIPTED"}
          </span>
        </div>

        <div className="space-y-4">
          {TURNS.slice(0, turn + 1).map((x, i) => (
            <div key={i} className="space-y-2">
              <p className="text-xs leading-relaxed text-zinc-400">
                <span className="font-mono text-[10px] text-zinc-600">AGENT </span>
                {x.agent}
              </p>
              {i < turn && (
                <p className="text-xs leading-relaxed text-zinc-200">
                  <span className="font-mono text-[10px] text-zinc-600">
                    PATIENT{" "}
                  </span>
                  {live ? "—" : x.scriptedPatient}
                </p>
              )}
            </div>
          ))}

          {dg.listening && (
            <p className="text-xs leading-relaxed text-zinc-200">
              <span className="font-mono text-[10px] text-emerald-500">
                PATIENT{" "}
              </span>
              {dg.transcript}
              <span className="text-zinc-600">{dg.interim}</span>
              <span className="ml-1 inline-block h-3 w-1 animate-pulse bg-emerald-500 align-middle" />
            </p>
          )}
        </div>
      </div>

      {/* response + controls */}
      <div className="rounded-lg border border-zinc-800 p-5">
        <div className="mb-4 font-mono text-[10px] tracking-wider text-zinc-600">
          PATIENT RESPONSE
        </div>

        {live ? (
          <>
            {heard && <p className="text-sm text-zinc-200">&ldquo;{heard}&rdquo;</p>}
            {!heard && !dg.listening && (
              <p className="text-xs text-zinc-600">
                {t.intent
                  ? "Press Listen and answer out loud."
                  : "No response required this turn."}
              </p>
            )}

            {understood !== null && (
              <pre className="mt-4 overflow-x-auto rounded border border-zinc-800 bg-zinc-900/50 p-3 font-mono text-[10px] text-zinc-500">
                {JSON.stringify(understood, null, 2)}
              </pre>
            )}
            {understood === null && heard && (
              <p className="mt-3 text-xs text-amber-500/80">
                {describeExtraction(null)}
              </p>
            )}

            {status && (
              <p className="mt-3 font-mono text-[10px] text-zinc-500">{status}</p>
            )}

            {t.intent ? (
              !dg.listening ? (
                <button
                  onClick={listen}
                  disabled={busy}
                  className="mt-5 w-full rounded border border-emerald-500/40 bg-emerald-500/10 py-2 font-mono text-[11px] tracking-wider text-emerald-400 transition hover:bg-emerald-500/20 disabled:opacity-40"
                >
                  LISTEN
                </button>
              ) : (
                <button
                  onClick={stopAndExtract}
                  className="mt-5 w-full rounded border border-red-500/40 bg-red-500/10 py-2 font-mono text-[11px] tracking-wider text-red-400 transition hover:bg-red-500/20"
                >
                  STOP &amp; EXTRACT
                </button>
              )
            ) : (
              <button
                onClick={() => commit(null)}
                disabled={busy}
                className="mt-5 w-full rounded border border-zinc-700 py-2 font-mono text-[11px] tracking-wider text-zinc-300 transition hover:bg-zinc-900 disabled:opacity-40"
              >
                {busy ? "RECOMPUTING…" : "NEXT"}
              </button>
            )}
          </>
        ) : (
          <>
            {t.scriptedPatient ? (
              <>
                <p className="text-sm text-zinc-200">
                  &ldquo;{t.scriptedPatient}&rdquo;
                </p>
                <pre className="mt-4 overflow-x-auto rounded border border-zinc-800 bg-zinc-900/50 p-3 font-mono text-[10px] text-zinc-500">
                  {JSON.stringify(t.scriptedSets, null, 2)}
                </pre>
              </>
            ) : (
              <p className="text-xs text-zinc-600">
                No response required this turn.
              </p>
            )}
            <button
              onClick={scriptedNext}
              disabled={busy}
              className="mt-5 w-full rounded border border-zinc-700 py-2 font-mono text-[11px] tracking-wider text-zinc-300 transition hover:bg-zinc-900 disabled:opacity-40"
            >
              {busy ? "RECOMPUTING…" : "NEXT"}
            </button>
          </>
        )}
      </div>

      {/* retrieval */}
      <div className="rounded-lg border border-zinc-800 p-5">
        <div className="mb-4 font-mono text-[10px] tracking-wider text-zinc-600">
          RETRIEVAL
        </div>
        {t.retrieval ? (
          <>
            <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
              <span className="text-zinc-500">{t.retrieval.doc}</span>
              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-emerald-500">
                {t.retrieval.ms}ms
              </span>
            </div>
            <blockquote className="mt-3 border-l-2 border-zinc-700 pl-3 text-xs italic leading-relaxed text-zinc-400">
              {t.retrieval.excerpt}
            </blockquote>
          </>
        ) : (
          <p className="text-xs text-zinc-600">No retrieval this turn.</p>
        )}
      </div>
    </div>
  );
}
