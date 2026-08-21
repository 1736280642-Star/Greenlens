import { randomUUID } from "node:crypto";
import type { EvidenceReindexPreview, EvidenceReindexRun, EvidenceReindexScope, PdfDocumentKind } from "@/types";
import type { EvidenceIdentityResolution } from "@/types";
import {
  countDocumentsForEvidenceRebuild,
  claimEvidenceReindexRun,
  createEvidenceReindexRun,
  evidenceReindexFunnel,
  findActiveEvidenceReindexRun,
  getDocumentForEvidenceRebuild,
  getEvidenceReindexRun,
  hasCompanyYearScore,
  listDocumentsForEvidenceRebuild,
  listActiveEvidenceReindexRuns,
  persistedCompanyAliases,
  persistedCompanyScoreRecords,
  recordEvidenceBackfillMigration,
  touchEvidenceRevision,
  replaceEvidenceForDocument,
  updateEvidenceReindexRun,
  upsertPdfEvidenceJob,
} from "./sqlite-store";
import {
  buildCompanyIdentityCandidates,
  CURRENT_EVIDENCE_EXTRACTOR_VERSION,
  extractDocumentEvidence,
  resolveDocumentIdentity,
} from "./evidence-extractor";
import { assessDocumentTextQuality, TEXT_QUALITY_ERROR_CODES } from "@/server/analysis/text-quality";
import { normalizeCompanyId, normalizeStockCode } from "./identity";

export interface EvidenceReindexOptions {
  scope?: EvidenceReindexScope;
  kind?: PdfDocumentKind;
  extractorVersion?: string;
  batchSize?: number;
}

const EVIDENCE_REINDEX_STALE_MS = 60_000;
const EVIDENCE_REINDEX_DEFAULT_BATCH_SIZE = 5;
const scheduledEvidenceRuns = new Set<string>();

function normalizedOptions(options: EvidenceReindexOptions = {}) {
  return {
    scope: options.scope ?? "missing_only" as EvidenceReindexScope,
    kind: options.kind ?? "esg_report" as PdfDocumentKind,
    extractorVersion: options.extractorVersion?.trim() || CURRENT_EVIDENCE_EXTRACTOR_VERSION,
    batchSize: Math.max(1, Math.min(50, Math.floor(options.batchSize ?? 20))),
  };
}

export function previewEvidenceReindex(options: EvidenceReindexOptions = {}): EvidenceReindexPreview {
  const normalized = normalizedOptions(options);
  const funnel = evidenceReindexFunnel();
  const candidateDocuments = countDocumentsForEvidenceRebuild(normalized);
  const sample = listDocumentsForEvidenceRebuild({ ...normalized, limit: Math.min(50, normalized.batchSize) });
  const candidates = buildCompanyIdentityCandidates(persistedCompanyScoreRecords(), persistedCompanyAliases());
  const resolutions = sample.map((document) => resolveDocumentIdentity({
    documentId: document.documentId,
    filename: document.filename,
    kind: document.kind,
    textMode: document.textMode,
    pages: document.pages,
    stockCode: document.metadata.stockCode,
    companyName: document.metadata.companyName,
    reportYear: document.metadata.reportYear,
    publicationDate: document.metadata.publicationDate,
  }, candidates));
  const sampledCompanyResolved = resolutions.filter((item) => item.resolvedCompanyId).length;
  const sampledYearResolved = resolutions.filter((item) => item.reportYear).length;
  const extractions = sample.map((document, index) => {
    const identity = resolutions[index];
    if (identity.status !== "resolved") return { evidence: [], aspects: [] };
    try {
      return extractDocumentEvidence({ document, identity, extractorVersion: normalized.extractorVersion });
    } catch {
      return { evidence: [], aspects: [] };
    }
  });
  const sampledEvidenceExtractable = extractions.filter((item) => item.evidence.length > 0).length;
  const sampledAutoLinked = resolutions.filter((item, index) => item.resolvedCompanyId && item.reportYear && extractions[index].evidence.length > 0 && hasCompanyYearScore(item.resolvedCompanyId, item.reportYear)).length;
  const estimatedAutoLinked = sample.length ? Math.round(candidateDocuments * sampledAutoLinked / sample.length) : 0;
  return {
    ...funnel,
    scope: normalized.scope,
    kind: normalized.kind,
    extractorVersion: normalized.extractorVersion,
    candidateDocuments,
    sampledDocuments: sample.length,
    sampledWithText: sample.filter((item) => item.pages.length > 0).length,
    sampledCompanyResolved,
    sampledYearResolved,
    sampledEvidenceExtractable,
    estimatedAutoLinked,
    estimatedManualReview: Math.max(0, candidateDocuments - estimatedAutoLinked),
    sampleCandidates: sample.map((document, index) => ({
      documentId: document.documentId,
      companyId: resolutions[index].resolvedCompanyId ?? undefined,
      reportYear: resolutions[index].reportYear ?? undefined,
      identityStatus: resolutions[index].status,
      scoreMatched: Boolean(resolutions[index].resolvedCompanyId && resolutions[index].reportYear && hasCompanyYearScore(resolutions[index].resolvedCompanyId!, resolutions[index].reportYear!)),
      evidenceCount: extractions[index].evidence.length,
    })),
  };
}

export function createEvidenceReindex(options: EvidenceReindexOptions = {}): EvidenceReindexRun {
  const normalized = normalizedOptions(options);
  const active = findActiveEvidenceReindexRun(normalized);
  if (active) return active;
  const totalCandidates = countDocumentsForEvidenceRebuild(normalized);
  return createEvidenceReindexRun({ jobId: randomUUID(), scope: normalized.scope, kind: normalized.kind, extractorVersion: normalized.extractorVersion, totalCandidates });
}

export function resumeEvidenceReindexRuns(batchSize = EVIDENCE_REINDEX_DEFAULT_BATCH_SIZE): string[] {
  const staleBefore = Date.now() - EVIDENCE_REINDEX_STALE_MS;
  const scheduled: string[] = [];
  for (const run of listActiveEvidenceReindexRuns()) {
    const updatedAt = Date.parse(run.updatedAt);
    if (run.status === "running" && Number.isFinite(updatedAt) && updatedAt >= staleBefore) continue;
    if (scheduledEvidenceRuns.has(run.jobId)) continue;
    scheduleEvidenceReindex(run.jobId, batchSize);
    scheduled.push(run.jobId);
  }
  return scheduled;
}

function markDocumentFailure(input: {
  run: EvidenceReindexRun;
  documentId: string;
  status: "identity_unresolved" | "text_unavailable" | "extraction_failed";
  errorCode: string;
  errorDetail: string;
  identityStatus?: string;
  identity?: EvidenceIdentityResolution;
}) {
  upsertPdfEvidenceJob({
    documentId: input.documentId,
    runId: input.run.jobId,
    status: input.status,
    identityStatus: input.identityStatus ?? "unresolved",
    linkageStatus: "unlinked",
    extractorVersion: input.run.extractorVersion,
    errorCode: input.errorCode,
    errorDetail: input.errorDetail,
    identity: input.identity,
    completedAt: new Date().toISOString(),
  });
}

export async function runEvidenceReindex(jobId: string, batchSize = 20): Promise<EvidenceReindexRun> {
  let run = getEvidenceReindexRun(jobId);
  if (!run) throw new Error(`Evidence reindex run ${jobId} was not found.`);
  if (["completed", "completed_with_warnings"].includes(run.status)) return run;
  const startedAt = run.startedAt ?? new Date().toISOString();
  const staleBefore = new Date(Date.now() - 60_000).toISOString();
  if (!claimEvidenceReindexRun(jobId, startedAt, staleBefore)) return getEvidenceReindexRun(jobId)!;
  run = getEvidenceReindexRun(jobId)!;
  const candidates = buildCompanyIdentityCandidates(persistedCompanyScoreRecords(), persistedCompanyAliases());
  const safeBatchSize = Math.max(1, Math.min(50, Math.floor(batchSize)));

  try {
    let cursor = run.cursor;
    while (true) {
      const batch = listDocumentsForEvidenceRebuild({ scope: run.scope, kind: run.kind, extractorVersion: run.extractorVersion, cursor, limit: safeBatchSize });
      if (!batch.length) break;
      for (const document of batch) {
        // Keep the HTTP server responsive while large reindex runs continue in-process.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        cursor = document.documentId;
        upsertPdfEvidenceJob({ documentId: document.documentId, runId: jobId, status: "resolving_identity", identityStatus: "pending", linkageStatus: "unlinked", extractorVersion: run.extractorVersion, incrementAttempts: true, startedAt: new Date().toISOString() });
        const identity = resolveDocumentIdentity({
          documentId: document.documentId,
          filename: document.filename,
          kind: document.kind,
          textMode: document.textMode,
          pages: document.pages,
          stockCode: document.metadata.stockCode,
          companyName: document.metadata.companyName,
          reportYear: document.metadata.reportYear,
          publicationDate: document.metadata.publicationDate,
        }, candidates);
        if (!document.pages.length) {
          markDocumentFailure({ run, documentId: document.documentId, status: "text_unavailable", errorCode: "TEXT_UNAVAILABLE", errorDetail: "No usable PDF page text was found." });
          run = updateEvidenceReindexRun(jobId, { processed: run.processed + 1, failed: run.failed + 1, cursor });
          continue;
        }
        if (identity.status !== "resolved") {
          upsertPdfEvidenceJob({ documentId: document.documentId, runId: jobId, status: "identity_unresolved", identityStatus: identity.status, linkageStatus: "unlinked", extractorVersion: run.extractorVersion, identity, errorCode: identity.status === "ambiguous" ? "IDENTITY_AMBIGUOUS" : "IDENTITY_UNRESOLVED", errorDetail: "Company or report year could not be resolved without ambiguity.", completedAt: new Date().toISOString() });
          run = updateEvidenceReindexRun(jobId, { processed: run.processed + 1, failed: run.failed + 1, cursor });
          continue;
        }

        upsertPdfEvidenceJob({ documentId: document.documentId, runId: jobId, status: "extracting", identityStatus: "resolved", linkageStatus: "pending", extractorVersion: run.extractorVersion, identity });
        try {
          const extracted = extractDocumentEvidence({
            document: { documentId: document.documentId, filename: document.filename, kind: document.kind, textMode: document.textMode, pages: document.pages, stockCode: identity.resolvedStockCode ?? undefined, reportYear: identity.reportYear ?? undefined, publicationDate: identity.publicationDate ?? undefined },
            identity,
            extractorVersion: run.extractorVersion,
          });
          if (!extracted.evidence.length) {
            const textQuality = assessDocumentTextQuality(document.pages);
            if (textQuality.issue) {
              markDocumentFailure({
                run, documentId: document.documentId, status: "text_unavailable", identityStatus: "resolved", identity,
                errorCode: TEXT_QUALITY_ERROR_CODES[textQuality.issue],
                errorDetail: `Page text failed the extraction quality gate (${textQuality.issue}); the source PDF should be reprocessed for a clean text layer.`,
              });
            } else {
              markDocumentFailure({ run, documentId: document.documentId, status: "extraction_failed", identityStatus: "resolved", identity, errorCode: "NO_ENVIRONMENTAL_EVIDENCE", errorDetail: "The parsed text did not contain statements matched by the environmental evidence rules." });
            }
            run = updateEvidenceReindexRun(jobId, { processed: run.processed + 1, failed: run.failed + 1, cursor });
            continue;
          }
          upsertPdfEvidenceJob({ documentId: document.documentId, runId: jobId, status: "aggregating", identityStatus: "resolved", linkageStatus: "pending", extractorVersion: run.extractorVersion, identity, evidenceCount: extracted.evidence.length });
          upsertPdfEvidenceJob({ documentId: document.documentId, runId: jobId, status: "linking", identityStatus: "resolved", linkageStatus: "pending", extractorVersion: run.extractorVersion, identity, evidenceCount: extracted.evidence.length });
          replaceEvidenceForDocument({ document, identity, extractorVersion: run.extractorVersion, evidence: extracted.evidence, aspects: extracted.aspects });
          const scoreMatched = hasCompanyYearScore(identity.resolvedCompanyId!, identity.reportYear!);
          upsertPdfEvidenceJob({
            documentId: document.documentId,
            runId: jobId,
            status: scoreMatched ? "completed" : "score_unmatched",
            identityStatus: "resolved",
            linkageStatus: scoreMatched ? "linked" : "score_unmatched",
            extractorVersion: run.extractorVersion,
            identity,
            evidenceCount: extracted.evidence.length,
            errorCode: scoreMatched ? undefined : "SCORE_UNMATCHED",
            errorDetail: scoreMatched ? undefined : "Evidence was preserved, but no exact company-year score record exists.",
            completedAt: new Date().toISOString(),
          });
          run = updateEvidenceReindexRun(jobId, {
            processed: run.processed + 1,
            succeeded: run.succeeded + (scoreMatched ? 1 : 0),
            failed: run.failed + (scoreMatched ? 0 : 1),
            cursor,
          });
        } catch (reason) {
          markDocumentFailure({ run, documentId: document.documentId, status: "extraction_failed", identityStatus: "resolved", identity, errorCode: "EXTRACTION_FAILED", errorDetail: reason instanceof Error ? reason.message : "Evidence extraction failed." });
          run = updateEvidenceReindexRun(jobId, { processed: run.processed + 1, failed: run.failed + 1, cursor });
        }
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const completedAt = new Date().toISOString();
    run = updateEvidenceReindexRun(jobId, { status: run.failed ? "completed_with_warnings" : "completed", completedAt, cursor });
    recordEvidenceBackfillMigration(run);
    return run;
  } catch (reason) {
    run = updateEvidenceReindexRun(jobId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      error: {
        cause: reason instanceof Error ? reason.message : "Evidence reindex failed.",
        impact: "The current run stopped; previously valid evidence was preserved.",
        nextAction: "Inspect the document-level job status and restart the failed or missing scope.",
      },
    });
    return run;
  }
}

export function scheduleEvidenceReindex(jobId: string, batchSize = 20) {
  if (scheduledEvidenceRuns.has(jobId)) return false;
  scheduledEvidenceRuns.add(jobId);
  setTimeout(() => {
    void runEvidenceReindex(jobId, batchSize)
      .catch(() => undefined)
      .finally(() => scheduledEvidenceRuns.delete(jobId));
  }, 0);
  return true;
}

export function confirmEvidenceDocumentIdentity(input: { documentId: string; companyId: string; reportYear: number; extractorVersion?: string }) {
  const document = getDocumentForEvidenceRebuild(input.documentId);
  if (!document) throw new Error("The PDF document was not found.");
  if (!document.pages.length) throw new Error("The PDF document has no reusable page text.");
  const companyId = normalizeCompanyId(input.companyId);
  const stockCode = normalizeStockCode(input.companyId);
  if (!companyId || !stockCode || !Number.isInteger(input.reportYear) || input.reportYear < 1990 || input.reportYear > new Date().getFullYear() + 1) throw new Error("The confirmed company or report year is invalid.");
  const candidates = buildCompanyIdentityCandidates(persistedCompanyScoreRecords(), persistedCompanyAliases());
  const candidate = candidates.find((item) => item.companyId === companyId);
  const identity: EvidenceIdentityResolution = {
    resolvedCompanyId: companyId,
    resolvedStockCode: stockCode,
    reportYear: input.reportYear,
    publicationDate: document.metadata.publicationDate ?? null,
    identityConfidence: 1,
    yearConfidence: 1,
    identitySources: ["manual_confirmation"],
    yearSource: "manual_confirmation",
    alternativeCandidates: [{ companyId, stockCode, companyName: candidate?.companyName ?? document.metadata.companyName ?? stockCode }],
    status: "resolved",
  };
  const extractorVersion = input.extractorVersion?.trim() || CURRENT_EVIDENCE_EXTRACTOR_VERSION;
  const extracted = extractDocumentEvidence({ document: { documentId: document.documentId, filename: document.filename, kind: document.kind, textMode: document.textMode, pages: document.pages, stockCode, reportYear: input.reportYear, publicationDate: identity.publicationDate ?? undefined }, identity, extractorVersion });
  if (!extracted.evidence.length) throw new Error("The confirmed document did not yield environmental evidence.");
  replaceEvidenceForDocument({ document, identity, extractorVersion, evidence: extracted.evidence, aspects: extracted.aspects });
  touchEvidenceRevision({ documentId: document.documentId, extractorVersion, evidenceCount: extracted.evidence.length });
  const scoreMatched = hasCompanyYearScore(companyId, input.reportYear);
  upsertPdfEvidenceJob({ documentId: document.documentId, status: scoreMatched ? "completed" : "score_unmatched", identityStatus: "manual_resolved", linkageStatus: scoreMatched ? "linked" : "score_unmatched", extractorVersion, identity, evidenceCount: extracted.evidence.length, errorCode: scoreMatched ? undefined : "SCORE_UNMATCHED", errorDetail: scoreMatched ? undefined : "Evidence was preserved, but no exact company-year score record exists.", completedAt: new Date().toISOString() });
  return { documentId: document.documentId, evidenceCount: extracted.evidence.length, aspectCount: extracted.aspects.length, linkageStatus: scoreMatched ? "linked" as const : "score_unmatched" as const, identity };
}
