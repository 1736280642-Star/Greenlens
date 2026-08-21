import { createHash } from "node:crypto";
import type { PdfPageBlock, PdfTextMode } from "@/types";

export const PDF_PARSER_VERSION = "pdfjs-5.4.149-text-v1";

function textFromItems(items: unknown[]) {
  return items.map((item) => {
    const value = item as { str?: unknown; hasEOL?: boolean };
    return typeof value.str === "string" ? `${value.str}${value.hasEOL ? "\n" : " "}` : "";
  }).join("").replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
}

export async function parsePdfText(bytes: Uint8Array, onPage?: (page: number, pageCount: number) => void) {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: true });
  const pdf = await loadingTask.promise;
  const pageCount = pdf.numPages;
  const pages: PdfPageBlock[] = [];
  let textPageCount = 0;
  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = textFromItems(content.items);
      if (text.replace(/\s/g, "").length >= 20) textPageCount += 1;
      pages.push({ page: pageNumber, text, textHash: createHash("sha256").update(text).digest("hex") });
      onPage?.(pageNumber, pageCount);
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }
  const textCoverage = pageCount ? textPageCount / pageCount : 0;
  const textMode: PdfTextMode = textCoverage === 1 ? "text" : textPageCount ? "mixed" : "ocr_required";
  return { pages, pageCount, textPageCount, textCoverage, textMode };
}
