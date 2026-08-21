import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const isolatedDb = path.join(mkdtempSync(path.join(tmpdir(), "greenlens-evidence-reindex-")), "test.sqlite");
process.env.GREENLENS_SQLITE_PATH = isolatedDb;
process.env.GREENLENS_DISABLE_LEGACY_MIGRATION = "1";

async function loadRuntime() {
  return Promise.all([import("./sqlite-store"), import("./evidence-reindex")]).then(([store, reindex]) => ({ store, reindex }));
}

describe("stored PDF evidence reindex", () => {
  it("reuses persisted page text and links rebuilt evidence to an exact company-year", async () => {
    const { store, reindex } = await loadRuntime();
    const ingestedAt = "2026-08-17T00:00:00.000Z";
    store.persistFullSnapshot({
      files: [], catalogs: [], financialRecords: [], companyIndustries: [], esgRatings: [], violationEvents: [],
      companyScores: [{
        id: "score-1", companyId: "stock-000001", stockCode: "000001", companyName: "合成材料股份有限公司", reportYear: 2024,
        sourceLabel: "000001_合成材料_2025-04-20_2024年度可持续发展报告", sourceFile: "score.xlsx", sourceSheet: "scores", sourceRow: 2,
        analysisScope: "main", sampleGroup: "main_n_ge_20", includeNGe10: true, includeNGe20: true, textLength: 1000, nAllSentences: 30, nEnvironmentalSentences: 10,
        EASS: 0.4, IR: 0.3, UPR: 0.6, sentimentRaw: 0.8, sentimentNorm: 0.8, sustainabilityRaw: 0.2, sustainabilityNorm: 0.2,
        esgsiRaw: 0.6, esgsiNorm: 0.6, eaaEsiRaw: 0.7, eaaEsiNorm: 0.7, baseRisk: "Relatively High", flagHighEsgsi: false, flagLowEass: true,
        flagHighIr: false, flagHighUpr: true, redFlags: 2, riskLevel: "High Risk", lowSentenceCountFlag: false, recommendedUse: "Main sample",
        duplicateCount: 1, qualityFlags: [], ingestedAt,
      }],
      pdfDocuments: [{
        id: "doc-1", provider: "baidu_netdisk", fsid: "fs-1", filename: "合成材料2024可持续发展报告.pdf", size: 100, kind: "esg_report",
        pageCount: 8, textPageCount: 2, textCoverage: 0.25, textMode: "text", parseStatus: "schema_pending", qualityFlags: ["COMPANY_CODE_UNRESOLVED"], ingestedAt,
        pages: [
          { page: 1, textHash: "cover-hash", text: "合成材料股份有限公司 2024年度可持续发展报告" },
          { page: 8, textHash: "action-hash", text: "公司已实施节能改造，2024年能源消耗同比降低12%，由环境管理部门负责。" },
        ],
      }], documentEvidence: [], environmentalAspects: [], lastSyncedAt: ingestedAt,
    });

    const preview = reindex.previewEvidenceReindex({ scope: "missing_only", extractorVersion: "evidence-rules-v2", batchSize: 20 });
    expect(preview).toMatchObject({ candidateDocuments: 1, sampledDocuments: 1, estimatedAutoLinked: 1 });
    const created = reindex.createEvidenceReindex({ scope: "missing_only", extractorVersion: "evidence-rules-v2" });
    const completed = await reindex.runEvidenceReindex(created.jobId, 10);

    expect(completed).toMatchObject({ status: "completed", processed: 1, succeeded: 1, failed: 0 });
    const items = store.persistedEvidenceItems("stock-000001", 2024);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ documentId: "doc-1", extractorVersion: "evidence-rules-v2", actionClass: "implemented" });
    expect(store.evidencePageText("stock-000001", items[0].id)).toMatchObject({ documentId: "doc-1", page: 8 });
    expect(store.evidenceReindexFunnel()).toMatchObject({ documentsWithTextPages: 1, evidenceExtractedDocuments: 1, linkedCompanyYearDocuments: 1 });
    const { liveCompanyRecords } = await import("@/server/analysis/live-analysis");
    const company = liveCompanyRecords().find((item) => item.companyId === "stock-000001" && item.reportYear === 2024);
    expect(company).toMatchObject({ evidenceLinkageStatus: "linked", environmentalActions: { totalStatements: 1, implemented: 1, planning: 0, indeterminate: 0 } });
    expect(company?.metrics.find((metric) => metric.code === "EASS")).toMatchObject({ rawValue: 1, formulaVersion: "evidence-actions-v2" });

    const rerunPreview = reindex.previewEvidenceReindex({ scope: "missing_only", extractorVersion: "evidence-rules-v2" });
    expect(rerunPreview.candidateDocuments).toBe(0);
  }, 60_000);

  it("resumes queued reindex runs once and completes empty scopes", async () => {
    const { store, reindex } = await loadRuntime();
    const created = reindex.createEvidenceReindex({ scope: "missing_only", extractorVersion: "evidence-rules-v2" });
    expect(created.status).toBe("queued");
    expect(reindex.resumeEvidenceReindexRuns()).toContain(created.jobId);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(store.getEvidenceReindexRun(created.jobId)).toMatchObject({ status: "completed", processed: 0, succeeded: 0, failed: 0 });
  }, 10_000);

  it("classifies garbled page text as text_unavailable instead of extraction_failed", async () => {
    const { store, reindex } = await loadRuntime();
    const ingestedAt = "2026-08-17T00:00:00.000Z";
    const garble = "\ue000\ue001\uf8ff".repeat(900);
    store.persistFullSnapshot({
      files: [], catalogs: [], financialRecords: [], companyIndustries: [], esgRatings: [], violationEvents: [],
      companyScores: [{
        id: "score-1", companyId: "stock-000001", stockCode: "000001", companyName: "合成材料股份有限公司", reportYear: 2024,
        sourceLabel: "000001_合成材料_2025-04-20_2024年度可持续发展报告", sourceFile: "score.xlsx", sourceSheet: "scores", sourceRow: 2,
        analysisScope: "main", sampleGroup: "main_n_ge_20", includeNGe10: true, includeNGe20: true, textLength: 1000, nAllSentences: 30, nEnvironmentalSentences: 10,
        EASS: 0.4, IR: 0.3, UPR: 0.6, sentimentRaw: 0.8, sentimentNorm: 0.8, sustainabilityRaw: 0.2, sustainabilityNorm: 0.2,
        esgsiRaw: 0.6, esgsiNorm: 0.6, eaaEsiRaw: 0.7, eaaEsiNorm: 0.7, baseRisk: "Relatively High", flagHighEsgsi: false, flagLowEass: true,
        flagHighIr: false, flagHighUpr: true, redFlags: 2, riskLevel: "High Risk", lowSentenceCountFlag: false, recommendedUse: "Main sample",
        duplicateCount: 1, qualityFlags: [], ingestedAt,
      }],
      pdfDocuments: [{
        id: "doc-garble", provider: "baidu_netdisk", fsid: "fs-garble", filename: "合成材料可持续发展报告.pdf", size: 100, kind: "esg_report",
        pageCount: 2, textPageCount: 1, textCoverage: 0.5, textMode: "text", parseStatus: "schema_pending", qualityFlags: [], ingestedAt,
        pages: [
          { page: 1, textHash: "cover-hash", text: "合成材料股份有限公司 2024年度可持续发展报告" },
          { page: 2, textHash: "garble-hash", text: garble },
        ],
      }], documentEvidence: [], environmentalAspects: [], lastSyncedAt: ingestedAt,
    });

    const created = reindex.createEvidenceReindex({ scope: "missing_only", extractorVersion: "evidence-rules-v2" });
    const completed = await reindex.runEvidenceReindex(created.jobId, 10);
    expect(completed).toMatchObject({ status: "completed_with_warnings", processed: 1, succeeded: 0, failed: 1 });
    expect(store.listPdfEvidenceExceptions()).toHaveLength(1);
    expect(store.listPdfEvidenceExceptions()[0]).toMatchObject({ documentId: "doc-garble", status: "text_unavailable", errorCode: "TEXT_QUALITY_GARBLED_CJK" });
  }, 30_000);
});
