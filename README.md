# Fluffy — CarePlan Preflight

**A compiler for care plans.** It checks whether a doctor's treatment plan is
actually executable by *that specific patient* before they leave the office —
and fails the build when it isn't.

Built for the YC × Medplum Agentic Healthcare Hackathon, August 2026.

---

## The problem

Healthcare systems record what clinicians **intend**. Almost nothing verifies
the patient can **execute** it.

A plan is clinically correct, then quietly fails — prior auth was needed, the
sequencing was wrong, the patient can't reach the lab during work hours, or the
patient misunderstood the dosing. Nobody finds out for four weeks, at the next
appointment, when nothing has happened.

Existing tools automate individual *steps* — referrals, prior auth, scheduling,
reminders. None ask whether the steps form a plan the patient can complete.

> [CHI-Bench](https://arxiv.org/abs/2605.16679) (May 2026) benchmarks agents on
> long-horizon, policy-rich healthcare workflows. Best agent: **28.0%** of tasks
> resolved. No agent clears 20% on strict pass. Single-session: **3.8%**.

## What it does

Takes a Medplum `CarePlan`, compiles it into a dependency graph, and evaluates
every requirement against clinical rules, payer signals, appointment
availability, and constraints surfaced in a patient conversation.

Each node resolves to `pass`, `blocked`, `needs_human_verification`, `pending`,
or `resolved`. Blockers become dependency-linked Medplum `Task`s with
`Provenance` pointing at the document that triggered them.

### Demo scenario

34F, new plaque psoriasis, works weekdays 8–6. Dermatologist proposes weekly
methotrexate, baseline labs first, follow-up in four weeks. Clinically correct,
completely un-executable:

| Blocker | Source |
|---|---|
| Prior authorization may be required | Stedi 270/271 |
| Baseline CBC + LFT must precede first dose | Monograph, via Moss |
| Lab is weekday-only; patient works 8–6 | Conversation + lab hours doc |
| **Patient believes the dose is daily. It's weekly.** | Conversation |
| Teratogenicity counseling undocumented | Monograph, via Moss |

Daily-instead-of-weekly methotrexate is a documented fatal medication error.

The agent then books an available Saturday slot at an affiliated lab, the graph
recomputes, and the clinician receives **only the unresolved blockers**.

## Sponsors

- **Medplum** — system of record *and* output format. `CarePlan`,
  `MedicationRequest`, `ServiceRequest`, a dependency-linked `Task` chain via
  `partOf`, `Provenance` per blocker, and `Appointment` booking against a real
  `Slot`.
- **Moss** — sub-10ms retrieval over medication protocols, laboratory hours and
  payer guidance, fired *inside* the conversation turn so a conflict surfaces
  before the patient finishes talking. Every blocker cites its source.
- **Deepgram** — the patient conversation. Surfaces what no intake form
  captures ("I can't get to the lab on weekdays"), catches the dosing
  misunderstanding, and reads the corrected plan back in plain language.
- **Stedi** — 270/271 eligibility in test mode, mapped to a typed preflight
  requirement. Never treated as an authorization decision.

## Safety

`propagate()` in `lib/types.ts` **only ever demotes**. A node reaches `pass` or
`resolved` solely through evidence — structured data, explicit patient
confirmation, or human verification — never because its upstream happens to be
clear.

Concretely: booking the lab appointment does not mark the labs complete, and
"nothing is blocking it" never means "it has been done". `scripts/selftest.ts`
asserts both.

The system does not diagnose, prescribe, or alter dosing. It flags that the
patient's understanding conflicts with the recorded plan and routes it to the
clinical team.

## Running it

```bash
npm install
cp .env.local.example .env.local     # fill in Medplum client credentials
npx tsx scripts/seed.ts              # seeds the demo patient, prints resource IDs
npm run dev
```

Every integration has a deterministic fallback, so the app runs with **zero
credentials** — a `CACHED:` badge in the header shows which subsystems are on
fallback rather than silently pretending they're live.

```bash
npx tsx scripts/selftest.ts   # full compile path, no credentials required
npx tsx scripts/check-env.ts  # which keys are set (never prints values)
```

## Layout

```
lib/types.ts               frozen contract — nodes, deps, propagate, summarize
lib/corpus.ts              the rule documents (Medplum + Moss both read this)
lib/preflight/build-nodes  assembles the 8 nodes from every source
lib/medplum/               auth, read, write (Tasks, Provenance, Appointment)
lib/moss/                  retrieval + fallback + latency measurement
lib/stedi/                 270/271 + canned fallback
app/api/preflight          GET  — compile
app/api/resolve            POST — resolve a blocker, or override constraints
app/api/resources          GET  — read back what landed in Medplum
```

---

*Care plans are written as lists. Patients experience them as dependency
graphs. We fail the build when the patient can't run it.*
