import { describe, expect, it } from "vitest";
import { companyYearListSchema, dashboardCommandCenterSchema } from "@/contracts/analysis";
import { ingestNetdiskRows } from "@/server/netdisk/local-netdisk";
import { liveCompanyRecords, liveDashboard } from "./live-analysis";

describe("EAA score records in live analysis", () => {
  it("builds schema-valid company-year records from EAA scores and drives the dashboard", () => {
    ingestNetdiskRows([
      {
        fsid: "score-2024", filename: "company_level_scoring_2024_EAA_ESI.xlsx", size: 10, rows: [
          {
            stock_code: "000001", company_short: "Synthetic Bank", year: 2024,
            company: "000001_Synthetic Bank_2025-03-08_2024年度社会责任报告",
            n_environmental_sentences: 35, EASS: 0.6, IR: 0.2, UPR: 0.1,
            sentiment_raw: 0.8, sentiment_norm: 0.8, sustainability_raw: 0.1, sustainability_norm: 0.2,
            ESGSI_raw: 0.9, ESGSI_norm: 0.7, EAA_ESI_raw: 1.0, EAA_ESI_norm: 0.65,
            base_risk: "Relatively High", flag_high_esgsi: true, flag_low_eass: false, flag_high_ir: false, flag_high_upr: false,
            red_flags: 1, risk_level: "High Risk", low_sentence_count_flag: false, recommended_use: "Main sample",
          },
        ],
      },
      {
        fsid: "industry-2024", filename: "company_industry_panel_2012_2024.csv", size: 10, rows: [
          { stock_code: "000001", report_year: 2024, industry_code: "J66", industry_name: "货币金融服务", source: "huazheng", quality_flag: "exact" },
        ],
      },
    ], false);

    const records = liveCompanyRecords();
    expect(records).toHaveLength(1);
    const record = companyYearListSchema.parse(records)[0];
    expect(record.finalIndex).toBe(0.65);
    expect(record.riskBand).toBe("high");
    expect(record.metrics.find((item) => item.code === "EAA_ESGSI")?.normalizedValue).toBe(0.65);
    expect(record.panelMetadata.sampleGroup).toBe("main_n_ge_20");
    expect(record.industry).toBe("货币金融服务");
    dashboardCommandCenterSchema.parse(liveDashboard({ year: 2024 }));
  }, 60_000);
});
