import { describe, expect, it } from "vitest";
import { alignReportYearToScores, inferPublicationDate, inferReportYear, normalizeCompanyId, normalizeStockCode } from "./identity";

describe("netdisk identity normalization", () => {
  it("normalizes every supported stock-code shape to the canonical company id", () => {
    expect(normalizeStockCode("1")).toBe("000001");
    expect(normalizeStockCode("SZ000001")).toBe("000001");
    expect(normalizeCompanyId("stock:1")).toBe("stock-000001");
    expect(normalizeCompanyId("stock-000001")).toBe("stock-000001");
  });

  it("prefers the report period in document text over a publication year in the filename", () => {
    expect(inferReportYear("2024 年年度报告", "000001_2025-04-20.pdf")).toBe(2024);
  });

  it("separates the publication date from the report year in a filename", () => {
    const filename = "000001_2022-04-20_2021年年度报告.pdf";
    expect(inferPublicationDate(filename)).toBe("2022-04-20");
    expect(inferReportYear("", filename)).toBe(2021);
  });

  it("aligns a publication year to the preceding available score year", () => {
    expect(alignReportYearToScores(2025, [2021, 2022, 2024])).toBe(2024);
    expect(alignReportYearToScores(2022, [2021, 2022])).toBe(2022);
    expect(alignReportYearToScores(2035, [2024])).toBe(2035);
  });
});
