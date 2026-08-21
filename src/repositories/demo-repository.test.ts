import { afterEach, describe, expect, it, vi } from "vitest";
import { demoRepository } from "./demo-repository";
import { buildDashboardCommandCenter } from "./dashboard-command-center";
import type { GsiScoreRecord } from "@/types";

describe("demoRepository", () => {
  afterEach(() => vi.useRealTimers());

  it("returns stable synthetic company data through the repository contract", async () => {
    const items = await demoRepository.listCompanies();
    expect(items).toHaveLength(30);
    expect(items[0]).toMatchObject({ companyId: "cy-materials", reportYear: 2025, riskBand: "high", reportId: "report-cy-materials-2025" });
    expect(items[0].finalIndexRaw).not.toBe(items[0].finalIndex);
    expect(items[0].finalIndex).toBeLessThanOrEqual(1);
    expect(items[0].versions.schema).toBe("metric-contract-v2");
    expect(items[0].metrics.map((metric) => metric.code)).toEqual(["EASS", "IR", "UPR", "ESGSI", "EAA_ESI", "IMBALANCE"]);
  });

  it("supports empty and error acceptance scenarios", async () => {
    await expect(demoRepository.listCompanies("empty")).resolves.toEqual([]);
    await expect(demoRepository.listCompanies("error")).rejects.toThrow("演示数据载入失败");
  });

  it("keeps evidence scoped to the requested synthetic company", async () => {
    const items = await demoRepository.listEvidence("cy-materials");
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items.every((item) => item.companyId === "cy-materials")).toBe(true);
  });

  it("resolves evidence PDF page text from the repository boundary", async () => {
    const items = await demoRepository.listEvidence("cy-materials", "success", 2025);
    const page = await demoRepository.getEvidencePageText("cy-materials", items[0].id);
    expect(page).toMatchObject({ evidenceId: items[0].id, companyId: "cy-materials", pageCount: 86 });
    expect(page?.text).toBe(items[0].excerpt);
    await expect(demoRepository.getEvidencePageText("cy-materials", "missing-evidence")).resolves.toBeNull();
  });

  it("persists skipped review queue actions through the repository boundary", async () => {
    const action = { id: "skip-test-task", taskId: "test-task", companyId: "cy-materials", action: "skip" as const, actedAt: new Date().toISOString() };
    await expect(demoRepository.saveReviewQueueAction(action)).resolves.toEqual(action);
    await expect(demoRepository.listReviewQueueActions()).resolves.toContainEqual(action);
  });

  it("returns aspect-level Salience and AS records that reconcile to the company EASS", async () => {
    const company = await demoRepository.getCompany("cy-materials", "success", 2025);
    const aspects = await demoRepository.listEnvironmentalAspects("cy-materials", 2025);
    expect(company).not.toBeNull();
    expect(aspects).toHaveLength(5);
    expect(aspects.reduce((sum, item) => sum + item.salience, 0)).toBeCloseTo(1, 5);
    const weightedEass = aspects.reduce((sum, item) => sum + item.salience * (item.actionScore ?? 0), 0);
    expect(weightedEass).toBeCloseTo(company!.metrics.find((item) => item.code === "EASS")!.rawValue!, 4);
  });

  it("returns repository-backed history instead of page-generated substitute values", async () => {
    const company = await demoRepository.getCompany("cy-materials", "success", 2025);
    const history = await demoRepository.getCompanyHistory("cy-materials", { fromYear: 2016, toYear: 2025, metrics: ["EASS", "EAA_ESI"] });
    expect(history).toHaveLength(10);
    expect(Object.keys(history[0].metrics).sort()).toEqual(["EAA_ESI", "EASS"]);
    expect(history.at(-1)).toMatchObject({ reportYear: 2025, finalIndex: company!.finalIndex });
  });

  it("exposes dedicated financial and violation-event resources", async () => {
    const financial = await demoRepository.getFinancialYear("cy-materials", 2025);
    const events = await demoRepository.listViolationEvents("cy-materials", { fromYear: 2022, toYear: 2025 });
    expect(financial).toMatchObject({ sourceFields: { assetLiabilityRatio: "F011201A", roaA: "F050201B", totalAssets: "A001000000" } });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toMatchObject({ companyId: "cy-materials", reviewStatus: expect.any(String) });
    expect(events.some((event) => event.violationYears.length > 1)).toBe(true);
  });

  it("exposes source-aligned yearly panel audit summaries", async () => {
    const summaries = await demoRepository.listPanelYearSummaries({ fromYear: 2022, toYear: 2025 });
    expect(summaries).toHaveLength(4);
    expect(summaries[0]).toMatchObject({ year: 2022, uniqueCompanyYears: 30, sourceFile: expect.any(String) });
    expect(summaries.every((item) => item.sourceRows >= item.uniqueCompanyYears)).toBe(true);
  });

  it("scopes company and evidence lookups to the requested report year", async () => {
    await expect(demoRepository.getCompany("cy-materials", "success", 2025)).resolves.toMatchObject({ reportYear: 2025 });
    await expect(demoRepository.getCompany("cy-materials", "success", 2024)).resolves.toBeNull();
    await expect(demoRepository.listEvidence("cy-materials", "success", 2024)).resolves.toEqual([]);
  });

  it("resolves every metric evidence reference for every synthetic company", async () => {
    const companies = await demoRepository.listCompanies();
    const evidenceByCompany = await Promise.all(companies.map((company) => demoRepository.listEvidence(company.companyId)));
    companies.forEach((company, index) => {
      const available = new Set(evidenceByCompany[index].map((item) => item.id));
      const referenced = company.metrics.flatMap((metric) => metric.evidenceIds);
      expect(referenced.length).toBeGreaterThan(0);
      expect(referenced.every((id) => available.has(id))).toBe(true);
    });
  });

  it("returns stable dashboard operations and governance insights", async () => {
    const insights = await demoRepository.getDashboardInsights();
    expect(insights.reviewTasks).toHaveLength(8);
    expect(insights.reviewTasks[0]).toMatchObject({ id: "rv-1048", companyId: "cy-materials" });
    expect(insights.reviewTrend.at(-1)).toMatchObject({ date: "07-27", pending: 28 });
    expect(insights.modelAgreement).toHaveLength(6);
    expect(insights.sourceFreshness.some((source) => source.status === "stale")).toBe(true);
    const evidenceIds = new Map((await Promise.all((await demoRepository.listCompanies()).map(async (company) => [company.companyId, new Set((await demoRepository.listEvidence(company.companyId)).map((item) => item.id))] as const))));
    expect(insights.reviewTasks.every((task) => evidenceIds.get(task.companyId)?.has(task.evidenceId))).toBe(true);
  });

  it("returns a repository-aggregated Dashboard Command Center view model", async () => {
    const dashboard = await demoRepository.getDashboardCommandCenter("success", { year: 2025 });
    expect(dashboard.scope).toMatchObject({ reportYear: 2025, dataVersion: "SYN-2026.08" });
    expect(dashboard.scope.availableReportYears).toEqual([2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016]);
    expect(dashboard.kpis.sampleCount).toBe(30);
    expect(dashboard.metricTriad.map((item) => item.code)).toEqual(["RHETORIC_CONTENT", "ACTION_SUBSTANCE", "AMBIGUITY_VERIFICATION"]);
    expect(dashboard.metricTriad.every((item) => item.sampleCount === 30)).toBe(true);
    expect(dashboard.metricTriad.every((item) => item.q1 != null && item.medianValue != null && item.q3 != null && item.q1 <= item.medianValue && item.medianValue <= item.q3)).toBe(true);
    expect(dashboard.riskNodes).toHaveLength(30);
    expect(dashboard.annualTrend).toHaveLength(10);
    expect(dashboard.annualTrend.every((item) => item.meanFinalIndex != null && item.sampleCount === 30)).toBe(true);
    expect(dashboard.gsiRobustness).toMatchObject({ available: false, matchedCompanyCount: 0, dataVersion: null });
    expect(dashboard.redFlagTrend).toHaveLength(10);
    expect(dashboard.industryRisk.length).toBeGreaterThan(0);
    expect(dashboard.quality).toHaveLength(10);

    const historicalDashboard = await demoRepository.getDashboardCommandCenter("success", { year: 2020 });
    expect(historicalDashboard.scope.availableReportYears).toContain(2025);
    expect(historicalDashboard.scope.availableReportYears).toContain(2024);
  });

  it("joins deduplicated GSI company-year records as a separate robustness model", async () => {
    const companies = await demoRepository.listCompanies();
    const histories = (await Promise.all(companies.map((company) => demoRepository.getCompanyHistory(company.companyId)))).flat();
    const quality = await demoRepository.listPanelYearSummaries();
    const target = companies[0];
    const record: GsiScoreRecord = {
      id: "gsi-test", companyId: target.companyId, stockCode: target.stockCode, companyName: target.companyName, reportYear: target.reportYear,
      totalWords: 1_200, eCount: 20, sCount: 10, gCount: 5, eFocus: .02, sFocus: .01, gFocus: .005,
      imbalance: .015, gwScore: .6, coveragePenalty: .2, gsiFinal: .42, duplicateCount: 2,
      qualityFlags: ["GSI_DUPLICATE_COMPANY_YEAR_SELECTED_LONGEST_TEXT"], calculationStatus: "calculated",
      modelVersion: "gsi-fixed-v1", dataVersion: "GSI-test", sourceFile: "synthetic-gsi.csv", sourceRow: 2, importedAt: "2026-08-12T08:00:00.000Z",
    };
    const dashboard = buildDashboardCommandCenter(companies, histories, quality, { year: target.reportYear }, { gsiRecords: [record] });
    expect(dashboard.gsiRobustness).toMatchObject({ available: true, matchedCompanyCount: 1, duplicateGroupCount: 1, dataVersion: "GSI-test" });
    expect(dashboard.gsiRobustness.metrics.map((item) => item.code)).toEqual(["GSI", "COVERAGE_PENALTY", "IMBALANCE"]);
    expect(dashboard.riskNodes.find((node) => node.companyId === target.companyId)?.gsi).toMatchObject({ gsiFinal: .42, coveragePenalty: .2 });
  });

  it("returns structured AI risk interpretation through the repository contract", async () => {
    const interpretation = await demoRepository.getRiskInterpretation("cy-materials", 2025, "drivers");
    expect(interpretation).toMatchObject({ companyId: "cy-materials", reportYear: 2025, focus: "drivers" });
    expect(interpretation.drivers.length).toBeGreaterThan(0);
    expect(interpretation.citations.every((citation) => citation.evidenceId)).toBe(true);
    expect(interpretation.versions).toMatchObject({ data: expect.any(String), model: expect.any(String), score: expect.any(String), threshold: expect.any(String) });
  });

  it("keeps Dashboard Command Center filters inside the Repository boundary", async () => {
    const dashboard = await demoRepository.getDashboardCommandCenter("success", { year: 2025, industry: "新材料", sampleGroup: "main_n_ge_20" });
    expect(dashboard.riskNodes.every((node) => node.industry === "新材料")).toBe(true);
    expect(dashboard.kpis.sampleCount).toBe(dashboard.riskNodes.length);
    await expect(demoRepository.getDashboardCommandCenter("empty", { year: 2025 })).resolves.toMatchObject({ kpis: { sampleCount: 0 }, riskNodes: [] });
  });

  it("advances analysis jobs through the repository and returns recoverable extraction errors", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T08:00:00.000Z"));
    const normal = await demoRepository.createAnalysisJob({ companyId: "cy-materials", reportYear: 2025, fileName: "demo.pdf", fileSize: 1_024 });
    expect(await demoRepository.getAnalysisJob(normal.jobId)).toMatchObject({ status: "queued", phase: "collect" });
    vi.advanceTimersByTime(2_100);
    expect(await demoRepository.getAnalysisJob(normal.jobId)).toMatchObject({ status: "running", phase: "classify", progress: 63 });
    vi.advanceTimersByTime(1_500);
    expect(await demoRepository.getAnalysisJob(normal.jobId)).toMatchObject({ status: "completed", progress: 100 });

    const scan = await demoRepository.createAnalysisJob({ companyId: "cy-materials", reportYear: 2025, fileName: "scan-demo.pdf", fileSize: 1_024 });
    vi.advanceTimersByTime(1_500);
    expect(await demoRepository.getAnalysisJob(scan.jobId)).toMatchObject({ status: "failed", phase: "extract", error: { nextAction: "启用 OCR 后重新提交任务。" } });
  });
});
