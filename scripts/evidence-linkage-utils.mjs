const explicitReportYearPatterns = [
  /((?:19|20)\d{2})\s*年度/,
  /((?:19|20)\d{2})\s*年(?=(?:社会责任|企业社会责任|可持续发展|环境|ESG|CSR|年度报告))/i,
];

export function extractUniqueStockCode(filename) {
  const codes = [...new Set([...String(filename).matchAll(/(?<!\d)(\d{6})(?!\d)/g)].map((match) => match[1]))];
  return codes.length === 1 ? codes[0] : null;
}

export function extractExplicitReportYear(filename) {
  for (const pattern of explicitReportYearPatterns) {
    const match = String(filename).match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

export function selectSafeIdentityResolutions(rows, scorePairs) {
  const selected = [];
  for (const row of rows) {
    const stockCode = extractUniqueStockCode(row.filename);
    const reportYear = extractExplicitReportYear(row.filename);
    if (!stockCode || !reportYear) continue;
    const companyId = `stock-${stockCode}`;
    if (!scorePairs.has(`${companyId}:${reportYear}`)) continue;
    const alternatives = Array.isArray(row.alternativeCandidates) ? row.alternativeCandidates : [];
    if (alternatives.length !== 1 || alternatives[0]?.companyId !== companyId) continue;
    selected.push({ documentId: row.documentId, companyId, reportYear });
  }
  return selected;
}
