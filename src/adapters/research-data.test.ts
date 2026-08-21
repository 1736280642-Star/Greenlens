import { describe, expect, it } from "vitest";
import { mergeFinancialRows, normalizePanelMetadata, normalizePanelYearSummaryRow, normalizeStockCode, normalizeViolationRow, parseViolationYears } from "./research-data";

describe("research data adapters", () => {
  it("normalizes numeric and exchange-suffixed stock codes", () => {
    expect(normalizeStockCode(2)).toBe("000002");
    expect(normalizeStockCode("000020.SZ")).toBe("000020");
    expect(normalizeStockCode("600016.SH")).toBe("600016");
  });

  it("expands multi-year violation cells and ignores N/A", () => {
    expect(parseViolationYears("2019;2020;2021;N/A")).toEqual([2019, 2020, 2021]);
  });

  it("preserves missing penalties as null and emits quality flags", () => {
    const event = normalizeViolationRow({
      违规事件ID: 4095400,
      证券代码: 2,
      证券简称: "合成公司",
      违规年度: "2015;2016",
      公告日期: "2016-07-21 00:00:00",
      违规类型: "重大遗漏;重大遗漏",
      违规行为: "合成违规行为",
      处分措施: "出具监管函",
    }, { companyId: "synthetic-company", sourceLabel: "违规处理（结构测试）" });
    expect(event.stockCode).toBe("000002");
    expect(event.violationYears).toEqual([2015, 2016]);
    expect(event.totalPenalty).toBeNull();
    expect(event.qualityFlags).toContain("total_penalty_missing");
  });

  it("merges the three supplied financial indicator layouts by company and fiscal period", () => {
    const rows = [
      { Stkcd: "000001", ShortName: "合成银行", Accper: "2024-12-31", Typrep: "A", Source: 0, F011201A: .93 },
      { Stkcd: "000001", ShortName: "合成银行", Accper: "2024-12-31", Typrep: "A", Source: 0, F050201B: .007 },
      { Stkcd: "000001", ShortName: "合成银行", Accper: "2024-12-31", Typrep: "A", A001000000: 3_000_000_000_000 },
    ];
    const records = mergeFinancialRows(rows, { companyId: "synthetic-bank" });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ stockCode: "000001", reportYear: 2024, assetLiabilityRatio: .93, roaA: .007, totalAssets: 3_000_000_000_000 });
    expect(records[0].qualityFlags).toEqual([]);
  });

  it("maps company-panel audit fields including analysis_scope", () => {
    const metadata = normalizePanelMetadata({
      sample_group: "main_n_ge_20", include_n_ge_10: true, include_n_ge_20: true,
      analysis_scope: "Main analysis sample", low_sentence_count_flag: false, recommended_use: "Main results",
      years_available: 12, first_year: 2012, last_year: 2024, duplicate_count: 2, selected_for_panel: true,
      selection_note: "Selected canonical record", quality_flags: "duplicate_reviewed;title_checked",
      report_year_text_check: "target_year_found", code_source: "original", source_file: "source.xlsx",
      source_sheet: "Company-level scoring", source_row: 328,
    });
    expect(metadata).toMatchObject({ analysisScope: "Main analysis sample", sampleGroup: "main_n_ge_20", sourceRow: 328 });
    expect(metadata.qualityFlags).toEqual(["duplicate_reviewed", "title_checked"]);
  });

  it("maps every Year_summary audit column", () => {
    expect(normalizePanelYearSummaryRow({
      year: 2012, source_file: "source.xlsx", source_rows: 624, unique_company_years: 623,
      duplicate_groups: 1, extra_duplicate_rows: 1, selected_n_lt_10: 301, selected_n_10_19: 158,
      selected_n_ge_20: 164, title_target_year_not_found: 13, quality_flagged_rows: 0, code_recovered_from_company: 0,
    })).toEqual({
      year: 2012, sourceFile: "source.xlsx", sourceRows: 624, uniqueCompanyYears: 623,
      duplicateGroups: 1, extraDuplicateRows: 1, selectedNLt10: 301, selectedN10To19: 158,
      selectedNGe20: 164, titleTargetYearNotFound: 13, qualityFlaggedRows: 0, codeRecoveredFromCompany: 0,
    });
  });
});
