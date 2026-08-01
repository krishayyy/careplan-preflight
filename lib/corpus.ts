/**
 * The rule corpus. Single source of truth — seed.ts writes these to Medplum as
 * DocumentReferences, index-docs.ts pushes them to Moss. Keep them short and
 * deterministic; retrieval quality matters more than realism.
 */

export type CorpusDoc = {
  ruleId: string;
  docName: string;
  text: string;
  /** Filled in by seed.ts so Provenance can point at the DocumentReference. */
  medplumId?: string;
};

export const CORPUS: CorpusDoc[] = [
  {
    ruleId: "methotrexate-protocol",
    docName: "Methotrexate Initiation Protocol",
    text:
      "Methotrexate for plaque psoriasis is dosed ONCE WEEKLY. Daily administration " +
      "is a known fatal medication error. Baseline CBC, hepatic function panel, and " +
      "serum creatinine must be completed and reviewed by the prescribing clinician " +
      "BEFORE the first dose is taken.",
  },
  {
    ruleId: "safety-acknowledgment-rule",
    docName: "Methotrexate Safety Acknowledgment Requirement",
    text:
      "Methotrexate is contraindicated in pregnancy and is a known teratogen. " +
      "Documented patient counseling and acknowledgment of pregnancy-prevention " +
      "requirements is required prior to initiating therapy.",
  },
  {
    ruleId: "main-lab-hours",
    docName: "Central Laboratory Hours",
    text:
      "Central Laboratory. Open Monday through Friday, 8:00 AM to 5:00 PM. " +
      "Closed weekends and holidays. Patients unable to attend weekday hours " +
      "should be referred to an affiliated weekend location.",
  },
  {
    ruleId: "northside-lab-hours",
    docName: "Northside Laboratory Hours",
    text:
      "Northside Laboratory. Saturday appointments available 8:00 AM to 12:00 PM " +
      "for patients unable to attend weekday hours. Accepts standing orders from " +
      "affiliated clinics. No weekday service.",
  },
];

export function docFor(ruleId: string): CorpusDoc {
  const d = CORPUS.find((c) => c.ruleId === ruleId);
  if (!d) throw new Error(`Unknown ruleId: ${ruleId}`);
  return d;
}
