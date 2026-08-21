import assert from "node:assert/strict";
import test from "node:test";
import { extractExplicitReportYear, extractUniqueStockCode, selectSafeIdentityResolutions } from "./evidence-linkage-utils.mjs";

test("extracts one stock code and an explicit report year", () => {
  const filename = "000001_示例公司_2025-03-08_2024年度社会责任报告.pdf";
  assert.equal(extractUniqueStockCode(filename), "000001");
  assert.equal(extractExplicitReportYear(filename), 2024);
});

test("rejects conflicting stock codes and publication-date-only years", () => {
  assert.equal(extractUniqueStockCode("000001_提及000002_报告.pdf"), null);
  assert.equal(extractExplicitReportYear("000001_示例公司_2025-03-08_报告.pdf"), null);
});

test("selects only an exact unique candidate with an existing company-year score", () => {
  const rows = [
    { documentId: "safe", filename: "000001_示例_2024年度ESG报告.pdf", alternativeCandidates: [{ companyId: "stock-000001" }] },
    { documentId: "ambiguous", filename: "000002_示例_2024年度ESG报告.pdf", alternativeCandidates: [{ companyId: "stock-000002" }, { companyId: "stock-000003" }] },
    { documentId: "missing-score", filename: "000004_示例_2024年度ESG报告.pdf", alternativeCandidates: [{ companyId: "stock-000004" }] },
  ];
  assert.deepEqual(selectSafeIdentityResolutions(rows, new Set(["stock-000001:2024", "stock-000002:2024"])), [
    { documentId: "safe", companyId: "stock-000001", reportYear: 2024 },
  ]);
});
