import type { PatientConstraints } from "../types";

/** Which question the patient is answering — extraction is context-dependent. */
export type TurnIntent = "dosing_frequency" | "weekday_lab" | "saturday_offer";

const has = (t: string, ...words: string[]) =>
  words.some((w) => t.includes(w));

/**
 * Deterministic extraction from a patient utterance.
 *
 * Rules rather than an LLM, on purpose: there are three questions with narrow
 * answer spaces, and a demo needs the same input to produce the same output
 * every time. An LLM here would add latency, a dependency, and a way to be
 * wrong on stage without buying anything.
 *
 * Returns null when the answer is genuinely ambiguous — the agent re-asks
 * rather than guessing. Guessing what a patient said about their own dosing is
 * exactly the failure this product exists to catch.
 */
export function extractConstraints(
  transcript: string,
  intent: TurnIntent
): Partial<PatientConstraints> | null {
  const t = transcript.toLowerCase().trim();
  if (!t) return null;

  switch (intent) {
    case "dosing_frequency": {
      const daily = has(t, "every day", "everyday", "each day", "daily", "day");
      const weekly = has(t, "week", "weekly", "once a week", "sunday", "monday");
      // "once a week" contains "week"; check weekly first so it wins.
      if (weekly && !has(t, "every day", "everyday", "each day", "daily"))
        return { believedDosingFrequency: "weekly" };
      if (daily) return { believedDosingFrequency: "daily" };
      return null;
    }

    case "weekday_lab": {
      const no = has(t, "no", "can't", "cannot", "canot", "unable", "work", "job");
      const yes = has(t, "yes", "yeah", "yep", "sure", "i can", "that works");
      if (no && !yes) return { weekdayLabAvailable: false };
      if (yes) return { weekdayLabAvailable: true };
      return null;
    }

    case "saturday_offer": {
      const yes = has(t, "yes", "yeah", "yep", "sure", "works", "perfect", "ok", "okay");
      const no = has(t, "no", "can't", "cannot", "doesn't", "does not");
      if (no && !yes) return { acceptsSaturdaySlot: false };
      if (yes) return { acceptsSaturdaySlot: true };
      return null;
    }
  }
}

/** Human-readable summary of what was understood, shown next to the transcript. */
export function describeExtraction(
  c: Partial<PatientConstraints> | null
): string {
  if (!c) return "Could not determine — the agent will ask again.";
  if (c.believedDosingFrequency)
    return `Patient believes dosing is ${c.believedDosingFrequency}.`;
  if (c.weekdayLabAvailable === false)
    return "Patient cannot attend weekday laboratory hours.";
  if (c.weekdayLabAvailable === true)
    return "Patient can attend weekday laboratory hours.";
  if (c.acceptsSaturdaySlot === true) return "Patient accepts the Saturday slot.";
  if (c.acceptsSaturdaySlot === false) return "Patient declined the Saturday slot.";
  return "Understood.";
}
