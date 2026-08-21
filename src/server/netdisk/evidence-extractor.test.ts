import { describe, expect, it } from "vitest";
import type { CompanyScoreRecord } from "@/types";
import { buildCompanyIdentityCandidates, extractDocumentEvidence, resolveDocumentIdentity } from "./evidence-extractor";

const score = {
  id: "score-1", companyId: "stock-000001", stockCode: "000001", companyName: "合成材料股份有限公司", reportYear: 2024,
} as CompanyScoreRecord;

describe("PDF evidence identity and extraction", () => {
  it("resolves a company name and report period when the filename has no stock code", () => {
    const identity = resolveDocumentIdentity({
      documentId: "doc-1", filename: "合成材料2024可持续发展报告.pdf", kind: "esg_report", textMode: "text",
      pages: [{ page: 1, textHash: "cover-hash", text: "合成材料股份有限公司 2024年度可持续发展报告" }],
    }, buildCompanyIdentityCandidates([score]));

    expect(identity).toMatchObject({ status: "resolved", resolvedCompanyId: "stock-000001", resolvedStockCode: "000001", reportYear: 2024, yearSource: "cover_report_period" });
    expect(identity.identitySources).toContain("score_alias_exact");
  });

  it("keeps conflicting strong years out of automatic linkage", () => {
    const identity = resolveDocumentIdentity({
      documentId: "doc-conflict", filename: "合成材料2024报告.pdf", kind: "esg_report", textMode: "text", reportYear: 2023,
      pages: [{ page: 1, textHash: "cover-hash", text: "合成材料股份有限公司 2024年度可持续发展报告" }],
    }, buildCompanyIdentityCandidates([score]));

    expect(identity.status).toBe("ambiguous");
    expect(identity.resolvedCompanyId).toBeNull();
  });

  it("produces document-scoped, versioned and repeatable evidence", () => {
    const document = {
      documentId: "doc-1", filename: "合成材料2024可持续发展报告.pdf", kind: "esg_report" as const, textMode: "text" as const,
      pages: [{ page: 8, textHash: "page-hash", text: "公司已实施节能改造，2024年能源消耗同比降低12%，由环境管理部门负责。" }],
    };
    const identity = resolveDocumentIdentity({ ...document, pages: [{ page: 1, textHash: "cover", text: "证券代码：000001 2024年度可持续发展报告" }, ...document.pages] }, buildCompanyIdentityCandidates([score]));
    const first = extractDocumentEvidence({ document, identity, extractorVersion: "evidence-rules-v2" });
    const second = extractDocumentEvidence({ document, identity, extractorVersion: "evidence-rules-v2" });

    expect(first.evidence).toHaveLength(1);
    expect(first.evidence[0]).toMatchObject({ documentId: "doc-1", companyId: "stock-000001", stockCode: "000001", reportYear: 2024, page: 8, textHash: "page-hash", actionClass: "implemented", extractorVersion: "evidence-rules-v2" });
    expect(second.evidence[0].id).toBe(first.evidence[0].id);
    expect(first.aspects[0]).toMatchObject({ documentId: "doc-1", extractorVersion: "evidence-rules-v2", implemented: 1 });
  });
});
