import type { AnalysisRepository } from "@/repositories/analysis-repository";
import { demoRepository } from "@/repositories/demo-repository";
import { HttpAnalysisRepository } from "@/repositories/http-analysis-repository";

export type { AnalysisRepository, CompanyYearQuery, DemoScenario } from "@/repositories/analysis-repository";

// Production-like local runs use the normalized HTTP data pipeline by default.
// Tests and deterministic demos can still opt into fixtures explicitly with `mock`.
const repositoryMode = process.env.NEXT_PUBLIC_ANALYSIS_REPOSITORY ?? "http";
const apiBaseUrl = process.env.NEXT_PUBLIC_ANALYSIS_API_BASE_URL ?? "/api/v1";

export const analysisRepository: AnalysisRepository = repositoryMode === "http"
  ? new Proxy(demoRepository, {
      get(target, property) {
        const remote = new Set([
          "listCompanies", "getCompany", "listEvidence", "listEnvironmentalAspects", "getCompanyHistory",
          "getFinancialYear", "listViolationEvents", "listEsgRatings", "listPanelYearSummaries", "getDashboardCommandCenter",
          "getDashboardInsights", "getRiskInterpretation", "createAnalysisJob", "getAnalysisJob", "saveReview", "listReviewQueueActions", "saveReviewQueueAction", "getEvidencePageText",
          "getBaiduNetdiskStatus", "listBaiduNetdiskFiles", "getBaiduNetdiskFieldCatalog", "createBaiduNetdiskSync", "getBaiduNetdiskSyncJob",
        ]);
        const source = remote.has(String(property)) ? new HttpAnalysisRepository(apiBaseUrl) : target;
        const value = source[property as keyof AnalysisRepository];
        return typeof value === "function" ? value.bind(source) : value;
      },
    })
  : demoRepository;

export const analysisRepositoryMode = repositoryMode === "http" ? "http" : "mock";
