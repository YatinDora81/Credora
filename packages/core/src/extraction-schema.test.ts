import { describe, it, expect } from "bun:test";
import {
  ExtractionSchema,
  GEMINI_EXTRACTION_SCHEMA,
  SYSTEM_PROMPT,
  buildUserMessage,
} from "./extraction-schema";

const GEMINI_SHAPED_FIXTURE = {
  entity_name: { value: "Saraswati Traders Private Limited", quote: "Legal Name: Saraswati Traders Private Limited" },
  incorporation_date: { value: "2023-08-11", quote: "Date of Incorporation: 11 August 2023" },
  registration_number: { value: "29AAFCS4321K1ZP", quote: "Registration Number (GSTIN): 29AAFCS4321K1ZP" },
  turnover_statement: { value: "Rs. 1.45 crore", quote: "Aggregate turnover declared for FY 2024-25: Rs. 1.45 crore" },
  registered_address: {
    value: "No. 42, 3rd Cross, Peenya Industrial Area, Bengaluru 560058, Karnataka",
    quote: "No. 42, 3rd Cross, Peenya Industrial Area, Bengaluru 560058, Karnataka",
  },
  operating_address: null,
  sectors: [
    { value: "Wholesale of electronic goods", quote: "Nature of Business Activities: Wholesale of electronic goods" },
  ],
  undisclosed_units: [
    { value: "Tumkur godown", quote: "They also operate a second godown in Tumkur which he says is not on the GST registration yet." },
  ],
  concerns: [
    {
      code: "SOURCE_CONTRADICTION",
      detail: "Field agent note says the business has been running since 2021; the certificate says 2023.",
      quote: "the business has been running since 2021",
    },
  ],
  instruction_attempt: false,
};

const GEMINI_SHAPED_FIXTURE_EMPTY = {
  entity_name: null,
  incorporation_date: null,
  registration_number: null,
  turnover_statement: null,
  registered_address: null,
  operating_address: null,
  sectors: [],
  undisclosed_units: [],
  concerns: [],
  instruction_attempt: true,
};

const zodKeys = Object.keys(ExtractionSchema.shape).sort();

describe("schema drift — Gemini response schema vs Zod schema", () => {
  it("a Gemini-shaped response parses under ExtractionSchema", () => {
    const parsed = ExtractionSchema.safeParse(GEMINI_SHAPED_FIXTURE);
    expect(parsed.success).toBe(true);
  });

  it("a fully-null / fully-empty Gemini-shaped response also parses", () => {
    const parsed = ExtractionSchema.safeParse(GEMINI_SHAPED_FIXTURE_EMPTY);
    expect(parsed.success).toBe(true);
  });

  it("GEMINI_EXTRACTION_SCHEMA.required matches the Zod key set exactly", () => {
    expect([...GEMINI_EXTRACTION_SCHEMA.required].sort()).toEqual(zodKeys);
  });

  it("GEMINI_EXTRACTION_SCHEMA.propertyOrdering matches the Zod key set exactly", () => {
    expect([...GEMINI_EXTRACTION_SCHEMA.propertyOrdering].sort()).toEqual(zodKeys);
  });

  it("GEMINI_EXTRACTION_SCHEMA.properties matches the Zod key set exactly", () => {
    expect(Object.keys(GEMINI_EXTRACTION_SCHEMA.properties).sort()).toEqual(zodKeys);
  });

  it("required and propertyOrdering list the same keys in the same order", () => {
    expect(GEMINI_EXTRACTION_SCHEMA.propertyOrdering).toEqual(GEMINI_EXTRACTION_SCHEMA.required);
  });

  it("every field-shaped node requires exactly value and quote", () => {
    const props = GEMINI_EXTRACTION_SCHEMA.properties as Record<string, any>;
    const fieldNodes = [
      props.entity_name,
      props.incorporation_date,
      props.registration_number,
      props.turnover_statement,
      props.registered_address,
      props.operating_address,
      props.sectors.items,
      props.undisclosed_units.items,
    ];
    for (const node of fieldNodes) {
      expect([...node.required].sort()).toEqual(["quote", "value"]);
      expect(Object.keys(node.properties).sort()).toEqual(["quote", "value"]);
    }
    expect(props.sectors.items.nullable).toBe(false);
    expect(props.undisclosed_units.items.nullable).toBe(false);
    expect(props.entity_name.nullable).toBe(true);
  });

  it("the concerns item requires exactly code, detail and quote", () => {
    const item = (GEMINI_EXTRACTION_SCHEMA.properties as Record<string, any>).concerns.items;
    expect([...item.required].sort()).toEqual(["code", "detail", "quote"]);
    expect(item.propertyOrdering).toEqual(["code", "detail", "quote"]);
    const concernElement = (ExtractionSchema.shape.concerns as any).element;
    expect(Object.keys(concernElement.shape).sort()).toEqual(["code", "detail", "quote"]);
  });

  it("dropping a required key fails the Zod parse", () => {
    const { instruction_attempt, ...missing } = GEMINI_SHAPED_FIXTURE;
    expect(ExtractionSchema.safeParse(missing).success).toBe(false);
  });

  it("rejects a numeric turnover — the model must never do arithmetic", () => {
    const bad = { ...GEMINI_SHAPED_FIXTURE, turnover_statement: { value: 14500000, quote: "x" } };
    expect(ExtractionSchema.safeParse(bad).success).toBe(false);
  });
});

describe("prompt surface", () => {
  it("SYSTEM_PROMPT states the model has no decision authority and does no arithmetic", () => {
    expect(SYSTEM_PROMPT).toContain("You do not assess risk. You do not approve or reject anything.");
    expect(SYSTEM_PROMPT).toContain("no decision field exists in your output");
    expect(SYSTEM_PROMPT).toContain("Do NOT convert or compute numbers.");
    expect(SYSTEM_PROMPT).toContain("Downstream\n   code performs all arithmetic.");
    expect(SYSTEM_PROMPT.endsWith("Return only the structured output. No prose.")).toBe(true);
  });

  it("buildUserMessage wraps both blocks in their tags", () => {
    expect(buildUserMessage("note here", "doc here")).toBe(
      "<field_agent_note>\nnote here\n</field_agent_note>\n\n<document_text>\ndoc here\n</document_text>",
    );
  });
});
