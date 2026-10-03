import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";

/**
 * The thin stamp (T3): the account's public number and today's Cairo date, Latin text only. Per
 * MASTER-PLAN T24 a name is never transliterated; the Arabic name stamp arrives with D3 (sharp).
 */
export function stampText(publicNumber: string, now: Date): string {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return `${publicNumber} · ${date}`;
}

const FOOTER_SIZE = 9;
const MARK_SIZE = 34;
const MARK_OPACITY = 0.12;
const INK = rgb(0.07, 0.19, 0.18);

/** Draws `text` on every page: a footer line, and a light diagonal mark across the page centre. */
export async function stampPdf(source: Uint8Array, text: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(source);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const footerWidth = font.widthOfTextAtSize(text, FOOTER_SIZE);
    page.drawText(text, {
      x: (width - footerWidth) / 2,
      y: 14,
      size: FOOTER_SIZE,
      font,
      color: INK,
      opacity: 0.7,
    });
    const markWidth = font.widthOfTextAtSize(text, MARK_SIZE);
    page.drawText(text, {
      x: width / 2 - (markWidth / 2) * Math.cos(Math.PI / 6),
      y: height / 2 - (markWidth / 2) * Math.sin(Math.PI / 6),
      size: MARK_SIZE,
      font,
      color: INK,
      opacity: MARK_OPACITY,
      rotate: degrees(30),
    });
  }
  return pdf.save();
}
