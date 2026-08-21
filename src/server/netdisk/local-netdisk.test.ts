import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { afterEach, describe, expect, it, vi } from "vitest";
import { companyViolationEvents, financialRecord, ingestNetdiskPdfDocuments, ingestNetdiskRows, netdiskCompanyIndustries, netdiskCompanyScores, netdiskEsgRatings, netdiskFieldCatalog, netdiskFiles, netdiskPdfDocuments, netdiskRecordSummary, netdiskSyncJob, syncLocalNetdisk } from "./local-netdisk";

vi.hoisted(() => {
  process.env.GREENLENS_SQLITE_PATH = ":memory:";
  process.env.GREENLENS_DISABLE_LEGACY_MIGRATION = "1";
});

const originalRoot = process.env.GREENLENS_SOURCE_DIR;
const temporaryPaths: string[] = [];

afterEach(async () => {
  if (originalRoot == null) delete process.env.GREENLENS_SOURCE_DIR;
  else process.env.GREENLENS_SOURCE_DIR = originalRoot;
  await Promise.all(temporaryPaths.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("local netdisk importer", () => {
  it("ingests MCP-provided rows in memory without a local source directory", () => {
    delete process.env.GREENLENS_SOURCE_DIR;
    const job = ingestNetdiskRows([
      { fsid: "assets", filename: "16-25 企业资产总计.xlsx", size: 10, rows: [{ Stkcd: "000001", ShortName: "Synthetic Bank", Accper: "2024-12-31", Typrep: "A", Source: 0, A001000000: 2_000_000 }] },
      { fsid: "roa", filename: "16-25 ROA.xlsx", size: 10, rows: [{ Stkcd: "000001", ShortName: "Synthetic Bank", Accper: "2024-12-31", Typrep: "A", Source: 0, F050201B: 0.08 }] },
      { fsid: "debt", filename: "16-25资产负债率.xlsx", size: 10, rows: [{ Stkcd: "000001", ShortName: "Synthetic Bank", Accper: "2024-12-31", Typrep: "A", Source: 0, F011201A: 0.41 }] },
    ], false);
    expect(job).toMatchObject({ status: "completed", readyFileCount: 3 });
    expect(financialRecord("stock-000001", 2024)).toMatchObject({ totalAssets: 2_000_000, roaA: 0.08, assetLiabilityRatio: 0.41, qualityFlags: [] });
  });

  it("infers a violation workbook from fields and filters events by year range", () => {
    ingestNetdiskRows([{ fsid: "dated-case", filename: "2024.1.12.xlsx", size: 10, rows: [{
      "\u516c\u793a\u65f6\u95f4": "2024-01-12", "\u8bc1\u5238\u4ee3\u7801": "999999.SZ", "\u8bc1\u5238\u7b80\u79f0": "Synthetic Company", "\u5904\u7406\u5bf9\u8c61": "Synthetic Company", "\u6807\u9898": "Synthetic event", "\u53d1\u751f\u65e5\u671f": "2024-01-12", "\u5904\u7406\u7c7b\u578b": "Synthetic action", "\u8fdd\u89c4\u884c\u4e3a": "Synthetic behavior",
    }] }]);

    expect(netdiskFiles().find((file) => file.fsid === "dated-case")).toMatchObject({ kind: "violation_workbook", parseStatus: "ready" });
    expect(companyViolationEvents("stock-999999", { fromYear: 2024, toYear: 2024 })).toHaveLength(1);
    expect(companyViolationEvents("stock-999999", { fromYear: 2025 })).toHaveLength(0);
  });

  it("normalizes PDF evidence while keeping page text out of the metadata API", () => {
    const statement = "公司已实施节能改造，2024年能源消耗同比降低12%，由环境管理部门负责。";
    const job = ingestNetdiskPdfDocuments([{
      fsid: "pdf-1", filename: "000001_2024年度_ESG报告.pdf", size: 100, kind: "esg_report", pageCount: 1,
      textPageCount: 1, textCoverage: 1, textMode: "text", pages: [{ page: 8, text: statement, textHash: "hash-1" }],
    }], false);

    expect(job).toMatchObject({ status: "completed", readyFileCount: 1 });
    expect(netdiskPdfDocuments()[0]).toMatchObject({ stockCode: "000001", reportYear: 2024, textMode: "text", parseStatus: "ready" });
    expect(netdiskPdfDocuments()[0]).not.toHaveProperty("pages");
    const summary = netdiskRecordSummary();
    expect(summary).toMatchObject({ pdfDocumentCount: 1, esgDocumentCount: 1, ocrRequiredDocumentCount: 0 });
    expect(summary.documentEvidenceCount).toBeGreaterThanOrEqual(1);
    expect(summary.environmentalAspectCount).toBeGreaterThanOrEqual(1);
  });

  it("reads a synced finance workbook and normalizes its records", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "greenlens-netdisk-"));
    temporaryPaths.push(directory);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{
      Stkcd: 1, ShortName: "Synthetic Company", Accper: "2025-12-31", F011201A: 0.41, F050201B: 0.08, A001000000: 2000000,
    }]), "Finance");
    XLSX.writeFile(workbook, path.join(directory, "finance.xlsx"));
    process.env.GREENLENS_SOURCE_DIR = directory;

    const job = await syncLocalNetdisk();
    const source = netdiskFiles()[0];
    const catalog = netdiskFieldCatalog(source.id);
    const record = financialRecord("stock-000001", 2025);

    expect(job).toMatchObject({ status: "completed", discoveredFileCount: 1, readyFileCount: 1 });
    expect(netdiskSyncJob(job.jobId)).toMatchObject({ status: "completed", phase: "index" });
    expect(catalog?.fields).toContainEqual(expect.objectContaining({ sourceField: "F011201A", targetField: "assetLiabilityRatio", status: "mapped" }));
    expect(record).toMatchObject({ stockCode: "000001", companyName: "Synthetic Company", assetLiabilityRatio: 0.41, roaA: 0.08, totalAssets: 2000000 });
  });

  it("merges the three financial workbooks by company, period, report type, and source", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "greenlens-netdisk-"));
    temporaryPaths.push(directory);
    const write = (filename: string, field: "F011201A" | "F050201B" | "A001000000", value: number) => {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ Stkcd: "000001", ShortName: "Synthetic Bank", Accper: "2024-12-31", Typrep: "A", Source: 0, [field]: value }]), "sheet1");
      XLSX.writeFile(workbook, path.join(directory, filename));
    };
    write("16-25资产负债率.xlsx", "F011201A", 0.41);
    write("16-25 ROA.xlsx", "F050201B", 0.08);
    write("16-25 企业资产总计.xlsx", "A001000000", 2_000_000);
    process.env.GREENLENS_SOURCE_DIR = directory;

    await syncLocalNetdisk();

    expect(financialRecord("stock-000001", 2024)).toMatchObject({ assetLiabilityRatio: 0.41, roaA: 0.08, totalAssets: 2_000_000, qualityFlags: [] });
  });

  it("ingests EAA company score rows and deduplicates company-years", () => {
    ingestNetdiskRows([{
      fsid: "score-2016", filename: "company_level_scoring_2016_EAA_ESI.xlsx", size: 10, rows: [
        { stock_code: "000001", company_short: "Synthetic Bank", year: 2016, company: "000001_Synthetic Bank_2017-03-08_2016年度社会责任报告", n_environmental_sentences: 25, EASS: 0.6, IR: 0.2, UPR: 0.1, ESGSI_raw: 0.8, ESGSI_norm: 0.7, EAA_ESI_raw: 0.9, EAA_ESI_norm: 0.75, base_risk: "Relatively High", flag_high_esgsi: true, risk_level: "High Risk", recommended_use: "Main sample" },
        { company_short: "Synthetic Bank", year: 2016, company: "000001_Synthetic Bank_2017-04-01_2016年度ESG报告", n_environmental_sentences: 12, EASS: 0.5, IR: 0.3, UPR: 0.2, ESGSI_raw: 0.8, ESGSI_norm: 0.72, EAA_ESI_raw: 0.85, EAA_ESI_norm: 0.7, base_risk: "Relatively Medium", flag_low_eass: true, risk_level: "Medium Risk" },
        { company_short: "Synthetic Steel", company: "000002_Synthetic Steel_2017-03-08_2016年度社会责任报告", n_environmental_sentences: 8, EASS: 0.4, IR: 0.4, UPR: 0.3, ESGSI_raw: 0.9, ESGSI_norm: 0.8, EAA_ESI_raw: 1.1, EAA_ESI_norm: 0.8, base_risk: "Relatively High", risk_level: "High Risk" },
      ],
    }]);

    expect(netdiskFiles().find((file) => file.fsid === "score-2016")).toMatchObject({ kind: "company_score_workbook", parseStatus: "ready" });
    const scores = netdiskCompanyScores();
    expect(scores).toHaveLength(2);
    expect(scores.find((record) => record.stockCode === "000001")).toMatchObject({ reportYear: 2016, sampleGroup: "main_n_ge_20", duplicateCount: 2, EASS: 0.6, riskLevel: "High Risk" });
  });

  it("reads a synced EAA score workbook and normalizes company-year records", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "greenlens-netdisk-"));
    temporaryPaths.push(directory);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{
      stock_code: "000001", company_short: "Synthetic Bank", year: 2016, company: "000001_Synthetic Bank_2017-03-08_2016年度社会责任报告",
      n_environmental_sentences: 30, EASS: 0.6, IR: 0.2, UPR: 0.1, ESGSI_raw: 0.8, ESGSI_norm: 0.7, EAA_ESI_raw: 0.9, EAA_ESI_norm: 0.75,
      base_risk: "Relatively High", risk_level: "High Risk", recommended_use: "Main sample",
    }]), "Company-level scoring");
    XLSX.writeFile(workbook, path.join(directory, "company_level_scoring_2016_EAA_ESI.xlsx"));
    process.env.GREENLENS_SOURCE_DIR = directory;

    const job = await syncLocalNetdisk();

    expect(job).toMatchObject({ status: "completed", discoveredFileCount: 1, readyFileCount: 1 });
    expect(netdiskCompanyScores()).toHaveLength(1);
    expect(netdiskCompanyScores()[0]).toMatchObject({ stockCode: "000001", reportYear: 2016, eaaEsiNorm: 0.75, riskLevel: "High Risk" });
  });

  it("ingests a company-industry mapping and merges by company-year", () => {
    ingestNetdiskRows([{
      fsid: "industry-2024", filename: "company_industry_panel_2012_2024.csv", size: 10, rows: [
        { stock_code: "000001", report_year: 2024, industry_code: "J66", industry_name: "货币金融服务", source: "huazheng", quality_flag: "exact" },
        { stock_code: "000001", report_year: 2024, industry_code: "", industry_name: "金融业", source: "msci", quality_flag: "backfilled" },
        { stock_code: "000002", report_year: 2024, industry_code: "K70", industry_name: "房地产业", source: "csmar_shangdao", quality_flag: "exact" },
      ],
    }]);

    expect(netdiskFiles().find((file) => file.fsid === "industry-2024")).toMatchObject({ kind: "company_industry_workbook", parseStatus: "ready" });
    const industries = netdiskCompanyIndustries();
    expect(industries).toHaveLength(2);
    expect(industries.find((item) => item.stockCode === "000001")).toMatchObject({ reportYear: 2024, industryName: "货币金融服务", industryCode: "J66", qualityFlag: "exact" });
  });

  it("ingests unified external ESG rating rows and keeps the score-bearing variant", () => {
    ingestNetdiskRows([{
      fsid: "ratings-csmar", filename: "esg_ratings_csmar.csv", size: 10, rows: [
        { vendor: "csmar_shangdao", stock_code: "000001", company_name: "平安银行", report_year: 2023, rating: "A-", score: 72.5, e_score: 20, s_score: 25, g_score: 27.5, score_scale: "0-100" },
        { vendor: "csmar_shangdao", stock_code: "000001", company_name: "平安银行", report_year: 2023, rating: "A-", score: null, e_score: null, s_score: null, g_score: null, score_scale: "0-100" },
        { vendor: "csmar_runling", stock_code: "000002", company_name: "万科A", report_year: 2022, rating: "AA", score: 7.1, e_score: 2, s_score: 2.6, g_score: 2.5, score_scale: "0-10" },
      ],
    }]);

    expect(netdiskFiles().find((file) => file.fsid === "ratings-csmar")).toMatchObject({ kind: "esg_rating_workbook", parseStatus: "ready" });
    const ratings = netdiskEsgRatings();
    expect(ratings).toHaveLength(2);
    expect(ratings.find((item) => item.stockCode === "000001")).toMatchObject({ vendor: "csmar_shangdao", reportYear: 2023, rating: "A-", score: 72.5 });
  });

  it("normalizes the complete violation workbook fields into company event records", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "greenlens-netdisk-"));
    temporaryPaths.push(directory);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{
      "违规事件ID": 42, "证券代码": 2, "证券简称": "Synthetic Company", "违规年度": "2023;2024", "公告日期": "2024-06-01", "违规类型": "信息披露", "违规行为": "Synthetic behavior", "处分措施": "监管函", "处罚总金额": 100_000, "处罚金额(上市公司)": 80_000, "与上市公司关系": "公司自身", "违规主体名称": "Synthetic Company",
    }]), "Sheet1");
    XLSX.writeFile(workbook, path.join(directory, "违规处理_按年_2016_2024.xlsx"));
    process.env.GREENLENS_SOURCE_DIR = directory;

    await syncLocalNetdisk();

    expect(companyViolationEvents("stock-000002", 2024)).toContainEqual(expect.objectContaining({ id: "42", companyName: "Synthetic Company", violationYears: [2023, 2024], totalPenalty: 100_000, companyPenalty: 80_000 }));
  });

  it("detects a violation case sheet whose business header begins on the second row", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "greenlens-netdisk-"));
    temporaryPaths.push(directory);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["违规案例"],
      ["公示时间", "证券代码", "证券简称", "处理对象", "关联关系", "标题", "发生日期", "处理机构", "处理类型", "处理原因", "违规行为", "操作"],
      ["2024-06-01", "000002.SZ", "Synthetic Company", "Synthetic Company", "公司自身", "Synthetic title", "2024-05-01", "Synthetic authority", "监管关注", "Synthetic reason", "Synthetic behavior", "监管函"],
    ]), "违规案例");
    XLSX.writeFile(workbook, path.join(directory, "违规案例2024.xlsx"));
    process.env.GREENLENS_SOURCE_DIR = directory;

    await syncLocalNetdisk();

    expect(companyViolationEvents("stock-000002", 2024)).toContainEqual(expect.objectContaining({ title: "Synthetic title", authority: "Synthetic authority", action: "监管函", qualityFlags: expect.arrayContaining(["VIOLATION_YEAR_DERIVED_FROM_DATE"]) }));
  });
});
