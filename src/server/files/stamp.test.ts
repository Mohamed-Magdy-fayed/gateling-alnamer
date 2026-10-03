import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { stampPdf, stampText } from "./stamp";

const SAMPLE = readFileSync(path.resolve("media/sample/lesson-sample.pdf"));

describe("stampText", () => {
  it("is the public number and the Cairo calendar date, Latin only", () => {
    // 23:30 UTC on 30 Apr is already 1 May in Cairo.
    expect(stampText("AN-1042", new Date("2030-04-30T23:30:00.000Z"))).toBe("AN-1042 · 2030-05-01");
  });
});

describe("stampPdf", () => {
  it("keeps every page and changes the bytes", async () => {
    const before = await PDFDocument.load(SAMPLE);
    const stamped = await stampPdf(SAMPLE, "AN-1042 · 2030-05-01");
    const after = await PDFDocument.load(stamped);
    expect(after.getPageCount()).toBe(before.getPageCount());
    expect(Buffer.from(stamped).equals(SAMPLE)).toBe(false);
    expect(Buffer.from(stamped.slice(0, 4)).toString()).toBe("%PDF");
  });
});
