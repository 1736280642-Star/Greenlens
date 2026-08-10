import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReviewRecord } from "@/types";

const isolatedDb = path.join(mkdtempSync(path.join(tmpdir(), "greenlens-insights-")), "test.sqlite");
process.env.GREENLENS_SQLITE_PATH = isolatedDb;

import { companyYearListSchema, dashboardInsightsSchema, reviewRecordSchema } from "@/contracts/analysis";

async function loadRuntime() {
  return Promise.all([
    import("@/server/netdisk/sqlite-store"),
    import("@/server/netdisk/local-netdisk"),
    import("@/server/analysis/live-analysis"),
    import("@/server/analysis/dashboard-insights"),
  ]).then(([store, netdisk, live, insights]) => ({ store, netdisk, live, insights }));
}

afterEach(() => vi.useRealTimers());

describe("live dashboard insights and persisted backend records", () => {
  it("backfills score records, persists reviews/jobs, serves PDF page text, and derives insights", async () => {
    const { store, netdisk, live, insights } = await loadRuntime();
    netdisk.ingestNetdiskRows([
      {
        fsid: "score-2024", filename: "company_level_scoring_2024_EAA_ESI.xlsx", size: 10, rows: [{
          stock_code: "999998", company_short: "Synthetic Test Co", year: 2024,
          company: "999998_Synthetic Test Co_2025-03-08_2024年度社会责任报告",
          text_length: 300, n_all_sentences: 40, n_environmental_sentences: 18,
          EASS: 0.45, IR: 0.35, UPR: 0.65,
          sentiment_raw: 0.8, sentiment_norm: 0.8, sustainability_raw: 0.1, sustainability_norm: 0.2,
          ESGSI_raw: 0.9, ESGSI_norm: 0.7, EAA_ESI_raw: 1.0, EAA_ESI_norm: 0.62,
          base_risk: "Relatively High", flag_high_esgsi: true, flag_low_eass: true, flag_high_ir: true, flag_high_upr: true,
          red_flags: 4, risk_level: "High Risk", low_sentence_count_flag: false, recommended_use: "Main sample",
        }],
      },
      {
        fsid: "industry-2024", filename: "company_industry_panel_2012_2024.csv", size: 10, rows: [
          { stock_code: "999998", report_year: 2024, industry_code: "J66", industry_name: "货币金融服务", source: "huazheng", quality_flag: "exact" },
        ],
      },
      {
        fsid: "finance-2024", filename: "16-25 企业资产总计.xlsx", size: 10, rows: [
          { Stkcd: "999998", ShortName: "Synthetic Test Co", Accper: "2024-12-31", Typrep: "A", Source: 0, F011201A: 0.4, F050201B: 0.08, A001000000: 2_000_000 },
        ],
      },
    ], false);
    netdisk.ingestNetdiskPdfDocuments([{
      fsid: "pdf-2024", filename: "999998_Synthetic Test Co_2025-03-08_2024年度社会责任报告.pdf", size: 100, kind: "esg_report",
      pageCount: 2, textPageCount: 2, textCoverage: 1, textMode: "text",
      pages: [
        { page: 1, text: "公司计划在2030年前显著提高低碳材料占比，并持续减少温室气体排放，同时推进节能改造。", textHash: "hash-1" },
        { page: 2, text: "公司实施员工培训与社区公益项目，同时推进废弃物回收和污染治理，保障劳工权益。", textHash: "hash-2" },
      ],
    }], false);
    netdisk.persistNetdiskSnapshot();
    netdisk.persistNetdiskPdfState();

    const records = live.liveCompanyRecords();
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.companyId).toBe("stock-999998");
    expect(record.companyName).toBe("Synthetic Test Co");
    expect(record.environmentalActions.totalStatements).toBe(record.environmentalActions.implemented + record.environmentalActions.planning + record.environmentalActions.indeterminate);
    expect(record.environmentalActions.totalStatements).toBeGreaterThan(0);
    expect(record.planningVerification.totalPlanning).toBe(record.environmentalActions.planning);
    expect(record.planningVerification.verifiedPlanning + record.planningVerification.unverifiedPlanning).toBe(record.planningVerification.totalPlanning);
    expect(record.esgTopics.eCount).toBeGreaterThan(0);
    expect(record.esgTopics.imbalanceScore).toBeGreaterThanOrEqual(0);
    expect(record.esgTopics.imbalanceScore).toBeLessThanOrEqual(1);
    expect(record.textProcessing.tokenCount).toBe(200);
    const imbalance = record.metrics.find((metric) => metric.code === "IMBALANCE");
    expect(imbalance?.calculationStatus).toBe("calculated");
    expect(imbalance?.rawValue).not.toBeNull();
    companyYearListSchema.parse(records);

    const items = store.persistedEvidenceItems(record.companyId, record.reportYear);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].excerpt.length).toBeGreaterThan(0);
    const pageRef = store.evidencePageText(record.companyId, items[0].id, 2);
    expect(pageRef).not.toBeNull();
    expect(pageRef?.page).toBe(2);
    expect(pageRef?.pageCount).toBe(2);
    expect(pageRef?.text).toContain("员工培训");

    const review: ReviewRecord = {
      id: "review-test-1",
      targetId: items[0].id,
      companyId: record.companyId,
      targetType: "evidence",
      originalDecision: items[0].status,
      humanDecision: "confirm",
      reasonCode: "eass-manual-review",
      note: "Test note",
      reviewedAt: new Date().toISOString(),
    };
    const saved = store.saveReviewRecord(review);
    expect(reviewRecordSchema.parse(saved).id).toBe("review-test-1");
    expect(store.listReviewRecords({ companyId: record.companyId })).toHaveLength(1);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T08:00:00.000Z"));
    const job = store.createAnalysisJobRecord({ companyId: record.companyId, reportYear: 2024, fileName: "greenlens-demo.pdf", fileSize: 1024 });
    expect(store.getAnalysisJobRecord(job.jobId)).toMatchObject({ status: "queued", phase: "collect", progress: 4 });
    vi.advanceTimersByTime(2_100);
    expect(store.getAnalysisJobRecord(job.jobId)).toMatchObject({ status: "running", phase: "classify", progress: 63 });
    vi.advanceTimersByTime(1_500);
    expect(store.getAnalysisJobRecord(job.jobId)).toMatchObject({ status: "completed", progress: 100 });
    const scanJob = store.createAnalysisJobRecord({ companyId: record.companyId, reportYear: 2024, fileName: "scan-demo.pdf", fileSize: 1024 });
    vi.advanceTimersByTime(1_500);
    expect(store.getAnalysisJobRecord(scanJob.jobId)).toMatchObject({ status: "failed", phase: "extract", error: { nextAction: "启用 OCR 后重新提交任务。" } });
    vi.useRealTimers();

    const derived = insights.liveDashboardInsights();
    const parsed = dashboardInsightsSchema.parse(derived);
    expect(parsed.reviewTasks.length).toBeGreaterThan(0);
    const reportYears = new Map(records.map((item) => [item.companyId, item.reportYear]));
    for (const task of parsed.reviewTasks) {
      const year = reportYears.get(task.companyId);
      expect(year).toBeDefined();
      expect(store.persistedEvidenceItems(task.companyId, year).some((item) => item.id === task.evidenceId)).toBe(true);
    }
    expect(parsed.reviewTrend).toHaveLength(10);
    expect(parsed.modelAgreement).toHaveLength(6);
    expect(parsed.sourceFreshness.length).toBeGreaterThan(0);
    expect(parsed.evidenceCoverage.length).toBeGreaterThan(0);
  }, 60_000);
});
