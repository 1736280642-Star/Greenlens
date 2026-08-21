import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { selectSafeIdentityResolutions } from "./evidence-linkage-utils.mjs";

const baseUrl = process.env.GREENLENS_ORCHESTRATOR_BASE_URL?.trim() || "http://127.0.0.1:3130";
const parsedBaseUrl = new URL(baseUrl);
if (!new Set(["127.0.0.1", "localhost"]).has(parsedBaseUrl.hostname)) throw new Error("Evidence linkage orchestration is restricted to the local service.");

const runtimeDirectory = path.join(process.cwd(), ".greenlens-runtime");
const databasePath = process.env.GREENLENS_SQLITE_PATH?.trim() || path.join(runtimeDirectory, "greenlens.sqlite");
const outputDirectory = path.join(runtimeDirectory, "evidence-linkage-orchestrator");
const eventLogPath = path.join(outputDirectory, "events.ndjson");
const summaryPath = path.join(outputDirectory, "summary.json");
const processStatePath = path.join(outputDirectory, "process.json");
const pollIntervalMs = Math.max(15_000, Number(process.env.GREENLENS_ORCHESTRATOR_POLL_MS || 60_000));
const extractorVersion = process.env.GREENLENS_EVIDENCE_EXTRACTOR_VERSION?.trim() || "evidence-rules-v2";
mkdirSync(outputDirectory, { recursive: true });

function log(event, details = {}) {
  const record = { at: new Date().toISOString(), event, ...details };
  appendFileSync(eventLogPath, `${JSON.stringify(record)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(resource, init, retries = 5) {
  let lastError;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(new URL(resource, baseUrl), { ...init, signal: AbortSignal.timeout(300_000) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.cause || `HTTP ${response.status}`);
      return payload;
    } catch (reason) {
      lastError = reason;
      log("request_retry", { resource, attempt, cause: reason instanceof Error ? reason.message : String(reason) });
      if (attempt < retries) await delay(Math.min(60_000, attempt * 10_000));
    }
  }
  throw lastError;
}

function queueCounts(queue) {
  return {
    queued: Number(queue?.counts?.queued || 0),
    running: Number(queue?.counts?.running || 0),
    completed: Number(queue?.counts?.completed || 0),
    failed: Number(queue?.counts?.failed || 0),
    deferred: Number(queue?.deferred || 0),
  };
}

async function waitForPdfQueue() {
  let emptyChecks = 0;
  let previousSignature = "";
  while (emptyChecks < 2) {
    const queue = await requestJson("/api/v1/data-sources/baidu-netdisk/pdf-queue");
    const counts = queueCounts(queue);
    const signature = JSON.stringify(counts);
    if (signature !== previousSignature) {
      log("pdf_queue_progress", counts);
      previousSignature = signature;
    }
    emptyChecks = counts.queued === 0 && counts.running === 0 ? emptyChecks + 1 : 0;
    if (emptyChecks < 2) await delay(pollIntervalMs);
  }
  log("pdf_queue_drained");
}

async function previewScope(scope) {
  const payload = await requestJson("/api/v1/data-sources/baidu-netdisk/evidence-reindex", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scope, kind: "esg_report", extractorVersion, dryRun: true, batchSize: 50 }),
  });
  const preview = payload.preview;
  log("evidence_preview_completed", {
    scope,
    candidateDocuments: preview.candidateDocuments,
    sampledDocuments: preview.sampledDocuments,
    estimatedAutoLinked: preview.estimatedAutoLinked,
    estimatedManualReview: preview.estimatedManualReview,
  });
  return preview;
}

async function runScope(scope, preview) {
  if (!preview.candidateDocuments) return null;
  const payload = await requestJson("/api/v1/data-sources/baidu-netdisk/evidence-reindex", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scope, kind: "esg_report", extractorVersion, dryRun: false, batchSize: 20 }),
  });
  let run = payload.run;
  log("evidence_reindex_started", { scope, jobId: run.jobId, totalCandidates: run.totalCandidates });
  let lastProcessed = -1;
  while (["queued", "running"].includes(run.status)) {
    await delay(pollIntervalMs);
    run = await requestJson(`/api/v1/data-sources/baidu-netdisk/evidence-reindex/${run.jobId}`);
    if (run.processed !== lastProcessed) {
      log("evidence_reindex_progress", { scope, jobId: run.jobId, status: run.status, processed: run.processed, totalCandidates: run.totalCandidates, succeeded: run.succeeded, failed: run.failed });
      lastProcessed = run.processed;
    }
  }
  log("evidence_reindex_finished", { scope, jobId: run.jobId, status: run.status, processed: run.processed, succeeded: run.succeeded, failed: run.failed });
  if (run.status === "failed") throw new Error(run.error?.cause || `Evidence reindex ${run.jobId} failed.`);
  return run;
}

function readSafeIdentityResolutions() {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  database.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000;");
  try {
    const scorePairs = new Set(database.prepare("SELECT company_id,report_year FROM company_year_scores").all().map((row) => `${row.company_id}:${row.report_year}`));
    const rows = database.prepare(`
      SELECT pej.document_id,pd.source_label,pej.alternative_candidates
      FROM pdf_evidence_jobs pej
      JOIN pdf_documents pd ON pd.id=pej.document_id
      WHERE pej.status='identity_unresolved'
    `).all().map((row) => ({
      documentId: String(row.document_id),
      filename: String(row.source_label),
      alternativeCandidates: row.alternative_candidates ? JSON.parse(String(row.alternative_candidates)) : [],
    }));
    return { totalUnresolved: rows.length, candidates: selectSafeIdentityResolutions(rows, scorePairs) };
  } finally {
    database.close();
  }
}

async function resolveSafeIdentities() {
  const { totalUnresolved, candidates } = readSafeIdentityResolutions();
  log("safe_identity_resolution_started", { totalUnresolved, safeCandidates: candidates.length });
  let succeeded = 0;
  let failed = 0;
  for (const candidate of candidates) {
    try {
      await requestJson(`/api/v1/data-sources/baidu-netdisk/evidence-reindex/documents/${candidate.documentId}/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ companyId: candidate.companyId, reportYear: candidate.reportYear, extractorVersion }),
      }, 2);
      succeeded += 1;
    } catch (reason) {
      failed += 1;
      log("safe_identity_resolution_failed", { documentId: candidate.documentId, cause: reason instanceof Error ? reason.message : String(reason) });
    }
  }
  const result = { totalUnresolved, safeCandidates: candidates.length, succeeded, failed };
  log("safe_identity_resolution_finished", result);
  return result;
}

function readFinalSummary() {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  database.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=5000;");
  try {
    const grouped = (sql) => database.prepare(sql).all();
    const scoreCoverage = database.prepare(`
      SELECT COUNT(*) AS scorePairs,
             SUM(CASE WHEN EXISTS (SELECT 1 FROM evidence_items e WHERE e.company_id=s.company_id AND e.report_year=s.report_year) THEN 1 ELSE 0 END) AS linkedPairs
      FROM company_year_scores s
    `).get();
    return {
      completedAt: new Date().toISOString(),
      scoreCoverage,
      evidenceJobs: grouped("SELECT status,COALESCE(error_code,'NONE') AS errorCode,COUNT(*) AS count FROM pdf_evidence_jobs GROUP BY status,COALESCE(error_code,'NONE') ORDER BY count DESC"),
      pdfQueue: grouped("SELECT status,COUNT(*) AS count FROM pdf_queue GROUP BY status ORDER BY status"),
      pdfFailures: grouped("SELECT COALESCE(failure_category,'unclassified') AS category,COUNT(*) AS count FROM pdf_queue WHERE status='failed' GROUP BY COALESCE(failure_category,'unclassified') ORDER BY count DESC"),
    };
  } finally {
    database.close();
  }
}

async function main() {
  writeFileSync(processStatePath, `${JSON.stringify({ pid: process.pid, status: "running", startedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
  log("orchestrator_started", { extractorVersion, pollIntervalMs });
  await waitForPdfQueue();
  const missingPreview = await previewScope("missing_only");
  const missingRun = await runScope("missing_only", missingPreview);
  const identityResolution = await resolveSafeIdentities();
  const failedPreview = await previewScope("failed_only");
  const summary = { ...readFinalSummary(), missingPreview, missingRun, identityResolution, failedPreview };
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  writeFileSync(processStatePath, `${JSON.stringify({ pid: process.pid, status: "completed", completedAt: new Date().toISOString(), summaryPath }, null, 2)}\n`, "utf8");
  log("orchestrator_completed", { summaryPath, linkedPairs: summary.scoreCoverage.linkedPairs, scorePairs: summary.scoreCoverage.scorePairs, remainingFailedCandidates: failedPreview.candidateDocuments });
}

main().catch((reason) => {
  writeFileSync(processStatePath, `${JSON.stringify({ pid: process.pid, status: "failed", failedAt: new Date().toISOString(), cause: reason instanceof Error ? reason.message : String(reason) }, null, 2)}\n`, "utf8");
  log("orchestrator_failed", { cause: reason instanceof Error ? reason.message : String(reason) });
  process.exitCode = 1;
});
