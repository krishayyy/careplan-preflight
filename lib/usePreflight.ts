"use client";

import { useCallback, useState } from "react";
import type {
  NodeId,
  PatientConstraints,
  PreflightNode,
  PreflightResponse,
  PreflightSummary,
} from "./types";

const EMPTY: PreflightSummary = {
  passed: 0,
  blocked: 0,
  needsVerification: 0,
  pending: 0,
  buildPassing: false,
};

export type Phase = "plan" | "compiling" | "conversation" | "results";

export function usePreflight() {
  const [nodes, setNodes] = useState<PreflightNode[]>([]);
  const [summary, setSummary] = useState<PreflightSummary>(EMPTY);
  const [constraints, setConstraints] = useState<PatientConstraints>({});
  const [degraded, setDegraded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const apply = useCallback((r: PreflightResponse) => {
    setNodes(r.nodes);
    setSummary(r.summary);
    setConstraints(r.patientConstraints ?? {});
    setDegraded(r.degraded ?? []);
  }, []);

  /** Initial compile, or recompile with new constraints. */
  const run = useCallback(
    async (next: PatientConstraints = {}) => {
      setBusy(true);
      try {
        const qs = encodeURIComponent(JSON.stringify(next));
        const res = await fetch(`/api/preflight?constraints=${qs}`);
        apply((await res.json()) as PreflightResponse);
      } finally {
        setBusy(false);
      }
    },
    [apply]
  );

  /** Resolve a blocker — books the Saturday slot in Medplum. */
  const resolve = useCallback(
    async (nodeId: NodeId, action: string) => {
      setBusy(true);
      try {
        const res = await fetch("/api/resolve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ constraints, nodeId, action }),
        });
        apply((await res.json()) as PreflightResponse);
      } finally {
        setBusy(false);
      }
    },
    [constraints, apply]
  );

  /** Change reality and recompute — the "judge breaks it" path. */
  const override = useCallback(
    async (patch: Partial<PatientConstraints>) => {
      setBusy(true);
      try {
        const merged = { ...constraints, ...patch };
        const res = await fetch("/api/resolve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ constraints: merged }),
        });
        apply((await res.json()) as PreflightResponse);
      } finally {
        setBusy(false);
      }
    },
    [constraints, apply]
  );

  const reset = useCallback(() => {
    setNodes([]);
    setSummary(EMPTY);
    setConstraints({});
    setDegraded([]);
  }, []);

  return { nodes, summary, constraints, degraded, busy, run, resolve, override, reset };
}
