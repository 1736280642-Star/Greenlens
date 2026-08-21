const yearPattern = /(?<!\d)(?:19|20)\d{2}(?!\d)/g;

export function normalizeStockCode(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  const explicit = raw.match(/(?<!\d)(?:stock[-_: ]*)?(\d{6})(?!\d)/i)?.[1];
  if (explicit) return explicit;
  const short = raw.match(/(?<!\d)(\d{1,5})(?!\d)/)?.[1];
  return short ? short.padStart(6, "0") : null;
}

export function normalizeCompanyId(value: unknown): string | null {
  const code = normalizeStockCode(value);
  return code ? `stock-${code}` : null;
}

export function inferPublicationDate(filename: string): string | null {
  const match = filename.match(/(?<!\d)((?:19|20)\d{2})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/);
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${match[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function inferReportYear(leadText: string, filename: string): number | null {
  const reportPatterns = [
    /((?:19|20)\d{2})\s*\u5e74(?:\u5ea6)?[^\n\r]{0,24}(?:\u5e74\u5ea6\u62a5\u544a|\u793e\u4f1a\u8d23\u4efb\u62a5\u544a|\u73af\u5883\u62a5\u544a|\u53ef\u6301\u7eed\u53d1\u5c55\u62a5\u544a|ESG\s*\u62a5\u544a)/i,
    /(?:\u62a5\u544a\u671f|\u62a5\u544a\u5e74\u5ea6)\s*[:\uff1a]?\s*((?:19|20)\d{2})/,
    /(?:annual|sustainability|environmental|ESG)\s+report[^\d]{0,12}((?:19|20)\d{2})/i,
  ];
  for (const pattern of reportPatterns) {
    const match = leadText.match(pattern) ?? filename.match(pattern);
    if (match) return Number(match[1]);
  }

  const publicationDate = inferPublicationDate(filename);
  const withoutPublicationDate = publicationDate
    ? filename.replace(new RegExp(publicationDate.replaceAll("-", "[-/.]")), " ")
    : filename;
  const upperYear = new Date().getFullYear() + 1;
  const filenameYears = withoutPublicationDate.match(yearPattern)?.map(Number).filter((year) => year >= 1990 && year <= upperYear) ?? [];
  if (filenameYears.length) return filenameYears[0];
  return publicationDate ? Number(publicationDate.slice(0, 4)) - 1 : null;
}

export function alignReportYearToScores(candidate: number | null, scoreYears: readonly number[]): number | null {
  if (candidate == null || !scoreYears.length) return candidate;
  if (scoreYears.includes(candidate)) return candidate;
  if (scoreYears.includes(candidate - 1)) return candidate - 1;
  const nearest = [...scoreYears].sort((a, b) => Math.abs(a - candidate) - Math.abs(b - candidate))[0];
  return Math.abs(nearest - candidate) <= 1 ? nearest : candidate;
}
