import type { PdfPageBlock } from "@/types";

export type TextQualityIssue =
  | "garbled_cjk"
  | "foreign_script"
  | "too_few_chars"
  | "gid_leak"
  | "ascii_noise";

export interface TextQualityAssessment {
  issue: TextQualityIssue | null;
  totalChars: number;
  gidTokenCount: number;
  garbledCount: number;
  foreignCount: number;
  cjkCount: number;
  asciiLetterCount: number;
  asciiPunctCount: number;
  garbledRatio: number;
  foreignRatio: number;
  cjkRatio: number;
  asciiLetterRatio: number;
  asciiPunctRatio: number;
}

const GID_TOKEN_PATTERN = /\/?gid\d{4,}/g;
const CJK_GARBLED_RANGES: Array<[number, number]> = [
  [0x3400, 0x4dbf], // CJK Extension A
  [0xf900, 0xfaff], // CJK Compatibility Ideographs
  [0x2800, 0x28ff], // Braille patterns
  [0xe000, 0xf8ff], // Private Use Area
];
const FOREIGN_SCRIPT_RANGES: Array<[number, number]> = [
  [0x0b80, 0x0bff], [0x1000, 0x109f], [0x0f00, 0x0fff], [0x0980, 0x09ff],
  [0x0a80, 0x0aff], [0x0d00, 0x0d7f], [0x0d80, 0x0dff], [0x10a0, 0x10ff],
  [0x0400, 0x04ff], [0x0590, 0x05ff],
];

function inRanges(code: number, ranges: Array<[number, number]>) {
  return ranges.some(([start, end]) => code >= start && code <= end);
}

export function assessTextQuality(text: string): TextQualityAssessment {
  let totalChars = 0;
  let garbled = 0;
  let foreign = 0;
  let cjk = 0;
  let asciiLetter = 0;
  let asciiPunct = 0;
  const gidTokenCount = (text.match(GID_TOKEN_PATTERN) ?? []).length;

  for (const ch of text) {
    if (ch === " " || ch === "\n" || ch === "\t" || ch === "\r") continue;
    const code = ch.codePointAt(0)!;
    totalChars += 1;
    if (inRanges(code, CJK_GARBLED_RANGES)) garbled += 1;
    if (inRanges(code, FOREIGN_SCRIPT_RANGES)) foreign += 1;
    if (code >= 0x4e00 && code <= 0x9fff) cjk += 1;
    if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || (code >= 0x30 && code <= 0x39)) asciiLetter += 1;
    else if (code >= 0x21 && code <= 0x7e) asciiPunct += 1;
  }

  const garbledRatio = totalChars ? garbled / totalChars : 0;
  const foreignRatio = totalChars ? foreign / totalChars : 0;
  const cjkRatio = totalChars ? cjk / totalChars : 0;
  const asciiLetterRatio = totalChars ? asciiLetter / totalChars : 0;
  const asciiPunctRatio = totalChars ? asciiPunct / totalChars : 0;

  let issue: TextQualityIssue | null = null;
  if (totalChars < 500) issue = "too_few_chars";
  else if (gidTokenCount >= 50) issue = "gid_leak";
  else if (garbledRatio >= 0.12) issue = "garbled_cjk";
  else if (foreignRatio >= 0.10 && cjkRatio < 0.15) issue = "foreign_script";
  else if (cjkRatio < 0.05 && asciiPunctRatio >= 0.50 && asciiLetterRatio < 0.30) issue = "ascii_noise";

  return {
    issue, totalChars, gidTokenCount, garbledCount: garbled, foreignCount: foreign, cjkCount: cjk,
    asciiLetterCount: asciiLetter, asciiPunctCount: asciiPunct,
    garbledRatio, foreignRatio, cjkRatio, asciiLetterRatio, asciiPunctRatio,
  };
}

export function assessDocumentTextQuality(pages: PdfPageBlock[]): TextQualityAssessment {
  return assessTextQuality(pages.map((page) => page.text).join("\n"));
}

export const TEXT_QUALITY_ERROR_CODES: Record<TextQualityIssue, string> = {
  garbled_cjk: "TEXT_QUALITY_GARBLED_CJK",
  foreign_script: "TEXT_QUALITY_FOREIGN_SCRIPT",
  too_few_chars: "TEXT_QUALITY_TOO_FEW_CHARS",
  gid_leak: "TEXT_QUALITY_GID_LEAK",
  ascii_noise: "TEXT_QUALITY_ASCII_NOISE",
};