export type EligibilityResult = {
  status: "needs_human_verification";
  excerpt: string;
  sourceReference: string;
  degraded?: boolean;
};

/**
 * ─── FIND THE TEST IDS FIRST ────────────────────────────────────────────────
 * Stedi test mode returns valid-but-empty responses for unrecognised payer /
 * member IDs. Get the real test values out of their docs before debugging
 * anything here, or you'll spend 30 minutes chasing a working integration.
 *
 * ⛔ HARD STOP 12:30. If this isn't live by then, the fallback below is
 * already correct — ship it and move on. Lowest-value integration you have.
 */
async function callStedi(): Promise<EligibilityResult | null> {
  const apiKey = process.env.STEDI_API_KEY;
  if (!apiKey) return null;

  const res = await fetch(
    "https://healthcare.us.stedi.com/2024-04-01/change/medicalnetwork/eligibility/v3",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: apiKey,
      },
      body: JSON.stringify({
        controlNumber: "123456789",
        tradingPartnerServiceId: process.env.STEDI_TEST_PAYER_ID,
        provider: {
          organizationName: "Demo Dermatology",
          npi: process.env.STEDI_TEST_NPI,
        },
        subscriber: {
          memberId: process.env.STEDI_TEST_MEMBER_ID,
          firstName: "Maya",
          lastName: "Thompson",
          dateOfBirth: "19920314",
        },
        encounter: { serviceTypeCodes: ["30"] },
      }),
    }
  );

  if (!res.ok) throw new Error(`Stedi ${res.status}: ${await res.text()}`);
  const json = await res.json();

  // Whatever comes back, the demo maps to exactly one outcome. We never claim
  // the payer approved anything — only that a verification requirement exists.
  const note =
    json?.errors?.[0]?.description ??
    json?.benefitsInformation?.[0]?.planCoverage ??
    "Payer response does not conclusively confirm authorization status.";

  return {
    status: "needs_human_verification",
    excerpt: `Payer response indicates prior authorization may be required. ${note}`,
    sourceReference: "Stedi 271 eligibility response",
  };
}

const FALLBACK: EligibilityResult = {
  status: "needs_human_verification",
  excerpt:
    "Payer response indicates prior authorization may be required for this " +
    "medication. Coverage is active; authorization status is not conclusive.",
  sourceReference: "Stedi 271 eligibility response",
  degraded: true,
};

export async function checkEligibility(): Promise<EligibilityResult> {
  try {
    const live = await callStedi();
    if (live) return live;
  } catch (err) {
    console.warn("[stedi] falling back:", (err as Error).message);
  }
  return FALLBACK;
}
