import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { processAnalysisJob } from "./pdf-analysis-worker";
import { createAnalysisJobRecord, getAnalysisJobRecord, retryAnalysisJobRecord } from "@/server/netdisk/sqlite-store";

const tempDirectories: string[] = [];

function onePagePdf(text: string) {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, "binary");
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("local PDF analysis worker", () => {
  it("advances only from real work and persists a versioned result", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "greenlens-pdf-worker-"));
    tempDirectories.push(directory);
    const bytes = onePagePdf("Carbon emissions implemented and reduced by 20 percent.");
    const storagePath = path.join(directory, "report.pdf");
    await writeFile(storagePath, bytes);
    const fileHash = createHash("sha256").update(bytes).digest("hex");
    const job = createAnalysisJobRecord({
      companyId: `worker-test-${Date.now()}`,
      reportYear: 2025,
      fileName: "report.pdf",
      fileSize: bytes.length,
      mimeType: "application/pdf",
      fileHash,
      documentId: fileHash.slice(0, 24),
      storagePath,
    });

    expect(getAnalysisJobRecord(job.jobId)).toMatchObject({ status: "queued", progress: 0, stage: "uploaded" });
    await processAnalysisJob(job.jobId);
    expect(getAnalysisJobRecord(job.jobId)).toMatchObject({
      status: "completed",
      progress: 100,
      stage: "completed",
      document: { pageCount: 1, textPageCount: 1, textCoverage: 1 },
      result: { parserVersion: "pdfjs-5.4.149-text-v1", formulaVersion: "pdf-actions-v2", calculationStatus: "unavailable" },
    });

    expect(retryAnalysisJobRecord(job.jobId)).toMatchObject({ status: "queued", progress: 0, attempts: 2, stage: "uploaded" });
  }, 20_000);
});
