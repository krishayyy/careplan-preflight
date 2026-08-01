# Person A — Runbook

Everything in your lane is written and working. The whole compile path runs on
fallbacks right now, so **nothing below is blocking anyone.** Your job is to
swap fallbacks for live integrations, one at a time, verifying as you go.

```bash
npx tsx scripts/selftest.ts      # whole logic path, no credentials needed
npm run dev                       # http://localhost:3400
```

---

## Order of work

### 1. Medplum  (~30 min)

```bash
cp .env.local.example .env.local
```

1. `app.medplum.com` → sign up → create project
2. Admin → **Client Applications** → Create → copy ID + secret into `.env.local`
3. Seed:

```bash
npx tsx scripts/seed.ts
```

It prints an env block — paste it into `.env.local`. Idempotent, so re-run freely.

**Verify:** `curl -s localhost:3400/api/preflight | jq '.degraded'` no longer lists `medplum`.

> If `startClientLogin` 401s, the ClientApplication needs project membership or
> an AccessPolicy. Fix that in the admin panel before debugging code.

### 2. Moss  (~45 min)  ⚠️ smoke-test first

**Do not start with `index-docs.ts`.** Write a throwaway 10-liner that creates an
index, adds one document, queries it, and prints the result. Confirm the SDK
shape. Only then:

```bash
npx tsx lib/moss/index-docs.ts
```

That script also runs the two queries the demo depends on and prints the raw
responses, so you can see the real result shape.

If Moss's API differs from the guess in `lib/moss/retrieve.ts`, **that file is
the only thing that changes** — `queryMoss()` is the sole integration point.
Everything else imports `retrieve()`.

**Verify:** `npx tsx scripts/selftest.ts` — section 1 still returns Northside for
the Saturday query and the protocol for the dosing query, and `degraded` no
longer includes `moss`.

> If the Saturday query returns the wrong doc, edit the *document text* in
> `lib/corpus.ts` to contain "unable to attend weekday hours". Tune the corpus,
> not the query.

### 3. Stedi  (~30 min)  ⛔ hard stop 12:30

Find the **test payer ID, member ID, and NPI** in Stedi's test-mode docs first.
Wrong IDs return valid-but-empty responses and you will think you're broken.

Put them in `.env.local`, then check `lib/stedi/eligibility.ts`.

The fallback is already correct and demo-safe. If this isn't live by 12:30,
ship the fallback and move on — lowest-value integration you have.

**Never say Stedi approved anything.** The line is: *"the payer response
generated a preflight requirement for staff verification."*

### 4. Appointment booking  (~40 min)  ⛔ hard stop 14:30

`bookSaturdaySlot()` in `lib/medplum/write.ts` books the seeded Slot. Try the
Scheduling API beta first; if it resists, the plain `Appointment` create already
in that function is the fallback.

**Verify:**
```bash
curl -s -X POST localhost:3400/api/resolve -H 'content-type: application/json' \
  -d '{"constraints":{"weekdayLabAvailable":false},"nodeId":"lab-access","action":"schedule_appointment"}' | jq '.summary'
```
Then confirm the Appointment exists in the Medplum UI and the Slot is `busy`.

---

## What B needs from you

**Nothing — the endpoint is already live.** Tell B to point at it now rather than
waiting for 15:00:

```ts
const res = await fetch("/api/preflight?constraints=" +
  encodeURIComponent(JSON.stringify(constraints)));
```

It returns correctly-shaped `PreflightResponse` today, on fallbacks, and gets
progressively more real as you land each integration. The 15:00 checkpoint
becomes a formality instead of a cliff.

---

## API

```
GET  /api/preflight?constraints=<urlencoded json>[&skipWrite=1]
POST /api/resolve   { constraints, nodeId?, action? }
```

`degraded: string[]` on the response lists which subsystems are running on
fallback — render it as a badge so you always know what's live.

**Book the Saturday slot:**
```json
{ "constraints": {...}, "nodeId": "lab-access", "action": "schedule_appointment" }
```

**Judge-breaks-it:**
```json
{ "constraints": { "weekdayLabAvailable": true, "believedDosingFrequency": "weekly" } }
```

---

## Safety invariant — do not break this

`propagate()` in `lib/types.ts` **only ever demotes**. A node reaches `pass` or
`resolved` solely through evidence — structured data, explicit patient
confirmation, or human verification. Never because its upstream happens to be
clear.

Concretely: booking the lab appointment does *not* mark the labs complete, and
"nothing is blocking it" never means "it has been done". `scripts/selftest.ts`
asserts both. If you loosen this, the demo starts claiming a patient is cleared
to take methotrexate when nobody checked — which is the exact failure the
product exists to prevent.

---

## Files

| Path | Purpose |
|---|---|
| `lib/types.ts` | ⚠️ frozen contract — nodes, deps, propagate, summarize |
| `lib/corpus.ts` | the 4 rule documents (Medplum + Moss both read this) |
| `lib/medplum/client.ts` | auth |
| `lib/medplum/read.ts` | load bundle, synthetic fallback |
| `lib/medplum/write.ts` | Tasks (topological), Provenance, Appointment |
| `lib/moss/retrieve.ts` | retrieval + keyword fallback + latency |
| `lib/moss/index-docs.ts` | one-time indexing |
| `lib/stedi/eligibility.ts` | 270/271 + canned fallback |
| `lib/preflight/build-nodes.ts` | assembles the 8 nodes from all sources |
| `app/api/preflight/route.ts` | GET compile |
| `app/api/resolve/route.ts` | POST resolve / override |
| `scripts/seed.ts` | idempotent Medplum seed |
| `scripts/selftest.ts` | full logic path, no credentials |
