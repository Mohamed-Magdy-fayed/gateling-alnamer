import { describe, expect, it } from "vitest";
import { IBAN_COUNTRIES, normalizeIban, validateIban } from "./iban";

const VALID = {
  AE: "AE070331234567890123456",
  SA: "SA0380000000608010167519",
  JO: "JO94CBJO0010000000000131000302",
  QA: "QA58DOHB00001234567890ABCDEFG",
  KW: "KW81CBKU0000000000001234560101",
  BH: "BH67BMAG00001299123456",
  OM: "OM810180000001299123456",
  EG: "EG380019000500000000263180002",
} as const;

describe("normalizeIban", () => {
  it("drops spaces and dashes, upper-cases and turns Arabic-Indic digits Latin", () => {
    expect(normalizeIban(" ae07 0331-2345 6789 0123 456 ")).toBe("AE070331234567890123456");
    expect(normalizeIban("AE٠٧٠٣٣١٢٣٤٥٦٧٨٩٠١٢٣٤٥٦")).toBe("AE070331234567890123456");
    expect(normalizeIban("AE۰۷۰۳۳۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵۶")).toBe("AE070331234567890123456");
  });
});

describe("validateIban", () => {
  it("accepts a valid IBAN for every supported country", () => {
    expect(Object.keys(VALID).sort()).toEqual(Object.keys(IBAN_COUNTRIES).sort());
    for (const [country, iban] of Object.entries(VALID)) {
      expect(validateIban(iban)).toEqual({ ok: true, iban, country, last4: iban.slice(-4) });
    }
  });

  it("accepts spaced input and returns the normal form", () => {
    expect(validateIban("sa03 8000 0000 6080 1016 7519")).toMatchObject({
      ok: true,
      iban: VALID.SA,
    });
  });

  it("refuses a country outside the list", () => {
    expect(validateIban("GB82WEST12345698765432")).toEqual({ ok: false, reason: "country" });
  });

  it("refuses a wrong length for the country", () => {
    expect(validateIban(`${VALID.AE}0`)).toEqual({ ok: false, reason: "length" });
    expect(validateIban(VALID.AE.slice(0, -1))).toEqual({ ok: false, reason: "length" });
  });

  it("refuses a bad check", () => {
    expect(validateIban("AE080331234567890123456")).toEqual({ ok: false, reason: "checksum" });
    expect(validateIban("SA0380000000608010167518")).toEqual({ ok: false, reason: "checksum" });
  });

  it("refuses characters an IBAN cannot hold and empty input", () => {
    expect(validateIban("AE07033123456789012345*")).toEqual({ ok: false, reason: "format" });
    expect(validateIban("AEXX0331234567890123456")).toEqual({ ok: false, reason: "format" });
    expect(validateIban("")).toEqual({ ok: false, reason: "format" });
    expect(validateIban("07")).toEqual({ ok: false, reason: "format" });
  });
});
