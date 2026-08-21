import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const MAX_PDF_UPLOAD_BYTES = 30 * 1024 * 1024;
const pdfMagic = Buffer.from("%PDF-");

export class PdfUploadError extends Error {
  constructor(
    message: string,
    readonly impact: string,
    readonly nextAction: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function safeDisplayName(value: string) {
  return path.basename(value.normalize("NFKC")).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 240);
}

export async function persistUploadedPdf(file: File, companyId: string, reportYear: number) {
  const fileName = safeDisplayName(file.name);
  if (!fileName.toLowerCase().endsWith(".pdf")) {
    throw new PdfUploadError("文件扩展名不是 PDF。", "系统不会创建分析任务。", "请选择扩展名为 .pdf 的报告文件。");
  }
  if (file.size <= 0 || file.size > MAX_PDF_UPLOAD_BYTES) {
    throw new PdfUploadError("PDF 文件为空或超过 30MB 限制。", "文件无法进入解析队列。", "请选择 30MB 以内的非空 PDF。");
  }
  if (file.type && !["application/pdf", "application/octet-stream"].includes(file.type)) {
    throw new PdfUploadError(`文件 MIME 类型 ${file.type} 不受支持。`, "可疑文件不会被保存。", "请从可信来源重新导出标准 PDF。");
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length !== file.size || !bytes.subarray(0, pdfMagic.length).equals(pdfMagic)) {
    throw new PdfUploadError("文件内容不符合 PDF 魔数。", "伪装扩展名或损坏文件不会进入系统。", "请重新导出 PDF 后再上传。");
  }

  const fileHash = createHash("sha256").update(bytes).digest("hex");
  const documentId = createHash("sha256").update(`local-upload:${companyId}:${reportYear}:${fileHash}`).digest("hex").slice(0, 24);
  const uploadDirectory = path.join(process.cwd(), ".greenlens-runtime", "uploads");
  const storagePath = path.join(uploadDirectory, `${fileHash}.pdf`);
  await mkdir(uploadDirectory, { recursive: true });
  try {
    await writeFile(storagePath, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }

  return { documentId, fileName, fileSize: bytes.length, fileHash, storagePath, mimeType: file.type || "application/pdf" };
}
