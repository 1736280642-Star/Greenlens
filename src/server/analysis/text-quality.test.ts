import { describe, expect, it } from "vitest";
import { assessDocumentTextQuality, assessTextQuality, TEXT_QUALITY_ERROR_CODES } from "./text-quality";

function page(text: string, page = 1) {
  return { page, text, textHash: "hash" };
}

const cleanEsg = "公司在报告期内已完成多项节能改造工程，2024年能源消耗总量同比降低12%，温室气体排放强度下降8%，由环境管理部门负责实施并持续跟踪。".repeat(40);

describe("PDF text quality assessment", () => {
  it("returns no issue for a substantial CJK environmental statement", () => {
    const result = assessTextQuality(cleanEsg);
    expect(result.issue).toBeNull();
    expect(result.totalChars).toBeGreaterThan(500);
    expect(result.cjkRatio).toBeGreaterThan(0.5);
  });

  it("flags insufficient character count", () => {
    expect(assessTextQuality("让每个童年更美好 kidswant love & fun").issue).toBe("too_few_chars");
  });

  it("flags gid token leaks", () => {
    const text = "gid1234 gid1235 ".repeat(60) + "碳排放 排放 ".repeat(400);
    expect(assessTextQuality(text).issue).toBe("gid_leak");
  });

  it("flags private-use-area garble as garbled CJK", () => {
    const garble = "\ue000\ue001\uf8ff".repeat(1200);
    expect(assessTextQuality(garble).issue).toBe("garbled_cjk");
  });

  it("flags foreign scripts without material CJK content", () => {
    const foreign = "રસિક તમિળ ".repeat(800);
    expect(assessTextQuality(foreign).issue).toBe("foreign_script");
  });

  it("flags ascii punctuation noise", () => {
    const noise = "!@#$%^&*()_+{}|:<>?~".repeat(500);
    expect(assessTextQuality(noise).issue).toBe("ascii_noise");
  });

  it("assesses a document from page text blocks", () => {
    expect(assessDocumentTextQuality([page(cleanEsg.slice(0, 900)), page(cleanEsg.slice(900))]).issue).toBeNull();
  });

  it("maps every issue to a stable error code", () => {
    expect(Object.keys(TEXT_QUALITY_ERROR_CODES).sort()).toEqual(["ascii_noise", "foreign_script", "garbled_cjk", "gid_leak", "too_few_chars"]);
  });
});