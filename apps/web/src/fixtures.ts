import { SAMPLES, type SampleKey } from "@deepvue/core/fixtures";

export type { SampleKey };

export interface FixtureButton {
  key: SampleKey;
  label: string;
  hint: string;
}

export const FIXTURE_BUTTONS: FixtureButton[] = [
  {
    key: "A.1",
    label: "A.1 Sample",
    hint: "The base application: 30 months old, evidenced turnover 1.02 crore, one undisclosed unit.",
  },
  {
    key: "A.2.1",
    label: "A.2.1 Instruction",
    hint: "The document instructs the reviewer to approve. It must be reported as a concern and change nothing.",
  },
  {
    key: "A.2.2",
    label: "A.2.2 Arithmetic",
    hint: '"45 lakh a month" — the model must not annualise it; normaliseMoney does.',
  },
  {
    key: "A.2.3",
    label: "A.2.3 Sector",
    hint: "An excluded sector hides in the document while the structured field stays clean.",
  },
  {
    key: "A.2.4",
    label: "A.2.4 Nothing to read",
    hint: "Empty note and empty document: extraction succeeds and returns nothing.",
  },
];

function freshSuffix(): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export function stampExternalId<T extends { application_id_external?: string }>(
  payload: T,
): T {
  const base = (payload.application_id_external ?? "LN-2026-00000").split("-#")[0];
  return { ...payload, application_id_external: `${base}-#${freshSuffix()}` };
}

export function fixtureJson(key: SampleKey): string {
  return JSON.stringify(stampExternalId(SAMPLES[key]), null, 2);
}
