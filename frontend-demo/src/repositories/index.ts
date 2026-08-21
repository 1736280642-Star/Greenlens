import type { AnalysisRepository } from "@/repositories/analysis-repository";
import { HttpAnalysisRepository } from "@/repositories/http-analysis-repository";

export type { AnalysisRepository, CompanyYearQuery, DemoScenario } from "@/repositories/analysis-repository";

// Production-like local runs use the normalized HTTP data pipeline by default.
// Tests and deterministic demos can still opt into fixtures explicitly with `mock`.
const repositoryMode = process.env.NEXT_PUBLIC_ANALYSIS_REPOSITORY ?? "http";
const apiBaseUrl = process.env.NEXT_PUBLIC_ANALYSIS_API_BASE_URL ?? "/api/v1";

export const analysisRepositoryMode = repositoryMode === "http" ? "http" : "mock";

// The mock repository is loaded lazily so the HTTP (production-like) client
// bundle never ships the large synthetic fixture generator.
let mockRepositoryPromise: Promise<AnalysisRepository> | null = null;

function loadMockRepository(): Promise<AnalysisRepository> {
  mockRepositoryPromise ??= import("@/repositories/demo-repository").then((module) => module.demoRepository);
  return mockRepositoryPromise;
}

export const analysisRepository: AnalysisRepository = repositoryMode === "http"
  ? new HttpAnalysisRepository(apiBaseUrl)
  : new Proxy({} as AnalysisRepository, {
      get(_target, property) {
        return (...args: unknown[]) => loadMockRepository().then((repository) => {
          const value = (repository as unknown as Record<PropertyKey, unknown>)[property as PropertyKey];
          return typeof value === "function" ? (value as (...callArgs: unknown[]) => unknown)(...args) : value;
        });
      },
    });
