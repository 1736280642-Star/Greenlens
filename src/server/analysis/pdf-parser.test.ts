import { describe, expect, it } from "vitest";
import { parsePdfText } from "./pdf-parser";

function onePagePdf(text: string) {
  const escaped = text.replace(/([()\\])/g, "\\$1");
  const stream = `BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, "binary"));
}

describe("parsePdfText", () => {
  it("extracts page text and stable page metadata from a real PDF byte stream", async () => {
    const progress: Array<[number, number]> = [];
    const parsed = await parsePdfText(onePagePdf("Carbon emissions implemented and reduced by 20 percent."), (page, total) => progress.push([page, total]));

    expect(parsed).toMatchObject({ pageCount: 1, textPageCount: 1, textCoverage: 1, textMode: "text" });
    expect(parsed.pages[0].text).toContain("Carbon emissions implemented");
    expect(parsed.pages[0].textHash).toMatch(/^[a-f0-9]{64}$/);
    expect(progress).toEqual([[1, 1]]);
  }, 15_000);

  it("marks a PDF without usable text as OCR required", async () => {
    const parsed = await parsePdfText(onePagePdf(""));
    expect(parsed).toMatchObject({ pageCount: 1, textPageCount: 0, textCoverage: 0, textMode: "ocr_required" });
  }, 15_000);
});
