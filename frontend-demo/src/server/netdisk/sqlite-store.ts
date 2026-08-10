import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AnalysisJob, EnvironmentalAspectScore, EvidenceItem, EvidencePageReference, NetdiskPdfDocumentInput, PdfDocumentRecord, ReviewRecord } from "@/types";
import { alignReportYearToScores, inferPublicationDate, inferReportYear, normalizeCompanyId, normalizeStockCode } from "./identity";

type JsonRecord = Record<string, unknown>;
export interface SqliteSnapshot {
  files: JsonRecord[];
  catalogs: Array<[string, JsonRecord]>;
  financialRecords: JsonRecord[];
  companyScores: JsonRecord[];
  companyIndustries: JsonRecord[];
  esgRatings: JsonRecord[];
  violationEvents: JsonRecord[];
  pdfDocuments: Array<JsonRecord & { pages?: JsonRecord[] }>;
  documentEvidence: JsonRecord[];
  environmentalAspects: JsonRecord[];
  lastSyncedAt?: string;
}

const runtimeDirectory = path.join(process.cwd(), ".greenlens-runtime");
const databasePath = process.env.GREENLENS_SQLITE_PATH?.trim() || path.join(runtimeDirectory, "greenlens.sqlite");
const legacySnapshotPath = path.join(runtimeDirectory, "netdisk-data.json");
mkdirSync(path.dirname(databasePath), { recursive: true });

const globalDatabase = globalThis as typeof globalThis & { __greenlensSqlite?: DatabaseSync };
const database = globalDatabase.__greenlensSqlite ??= new DatabaseSync(databasePath);
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS source_files (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS field_catalogs (source_file_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS financial_records (record_key TEXT PRIMARY KEY, id TEXT NOT NULL, company_id TEXT NOT NULL, report_year INTEGER NOT NULL, payload TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_financial_company_year ON financial_records(company_id, report_year);
  CREATE TABLE IF NOT EXISTS company_year_scores (record_key TEXT PRIMARY KEY, id TEXT NOT NULL, company_id TEXT NOT NULL, report_year INTEGER NOT NULL, payload TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_score_company_year ON company_year_scores(company_id, report_year);
  CREATE TABLE IF NOT EXISTS company_industries (record_key TEXT PRIMARY KEY, id TEXT NOT NULL, company_id TEXT NOT NULL, report_year INTEGER NOT NULL, payload TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_industry_company_year ON company_industries(company_id, report_year);
  CREATE TABLE IF NOT EXISTS esg_ratings (record_key TEXT PRIMARY KEY, id TEXT NOT NULL, vendor TEXT NOT NULL, company_id TEXT NOT NULL, report_year INTEGER NOT NULL, payload TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_esg_rating_company_year ON esg_ratings(company_id, report_year);
  CREATE INDEX IF NOT EXISTS idx_esg_rating_vendor ON esg_ratings(vendor);
  CREATE TABLE IF NOT EXISTS violation_events (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, year_from INTEGER, year_to INTEGER, payload TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_violation_company_year ON violation_events(company_id, year_from, year_to);
  CREATE TABLE IF NOT EXISTS pdf_documents (id TEXT PRIMARY KEY, fsid TEXT NOT NULL, source_label TEXT NOT NULL, kind TEXT NOT NULL, text_mode TEXT NOT NULL, payload TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS pdf_pages (document_id TEXT NOT NULL, page INTEGER NOT NULL, text_hash TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY(document_id, page, text_hash));
  CREATE INDEX IF NOT EXISTS idx_pdf_pages_document ON pdf_pages(document_id, page);
  CREATE TABLE IF NOT EXISTS evidence_items (id TEXT PRIMARY KEY, source_label TEXT NOT NULL, payload TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_evidence_company_year ON evidence_items(json_extract(payload,'$.companyId'), CAST(json_extract(payload,'$.reportYear') AS INTEGER));
  CREATE TABLE IF NOT EXISTS environmental_aspects (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_aspects_company_year ON environmental_aspects(json_extract(payload,'$.companyId'), CAST(json_extract(payload,'$.reportYear') AS INTEGER));
  CREATE TABLE IF NOT EXISTS ingest_sessions (session_id TEXT PRIMARY KEY, task_type TEXT NOT NULL, status TEXT NOT NULL, accepted_count INTEGER NOT NULL DEFAULT 0, started_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT);
  CREATE TABLE IF NOT EXISTS ingest_session_items (session_id TEXT NOT NULL, item_key TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(session_id, item_key));
  CREATE TABLE IF NOT EXISTS ingest_session_rows (session_id TEXT NOT NULL, item_key TEXT NOT NULL, row_index INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(session_id, item_key, row_index));
  CREATE TABLE IF NOT EXISTS ingest_session_pages (session_id TEXT NOT NULL, item_key TEXT NOT NULL, page INTEGER NOT NULL, text_hash TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY(session_id, item_key, page, text_hash));
  CREATE TABLE IF NOT EXISTS pdf_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT, fsid TEXT NOT NULL UNIQUE, filename TEXT NOT NULL, remote_path TEXT NOT NULL,
    size INTEGER NOT NULL, md5 TEXT, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT, page_count INTEGER, text_page_count INTEGER, text_mode TEXT, queued_at TEXT NOT NULL, started_at TEXT, completed_at TEXT, updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pdf_queue_status ON pdf_queue(status, id);
  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    target_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    original_decision TEXT NOT NULL,
    human_decision TEXT,
    reason_code TEXT,
    note TEXT,
    reviewed_at TEXT NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reviews_company ON reviews(company_id);
  CREATE INDEX IF NOT EXISTS idx_reviews_reviewed_at ON reviews(reviewed_at);
  CREATE TABLE IF NOT EXISTS analysis_jobs (
    job_id TEXT PRIMARY KEY,
    report_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    report_year INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    status TEXT NOT NULL,
    phase TEXT NOT NULL,
    progress INTEGER NOT NULL,
    result_company_id TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_analysis_jobs_created ON analysis_jobs(created_at);
  CREATE TABLE IF NOT EXISTS worker_lease (id INTEGER PRIMARY KEY CHECK(id = 1), owner TEXT NOT NULL, expires_at REAL NOT NULL, updated_at TEXT NOT NULL);
`);
const financialColumns = database.prepare("PRAGMA table_info(financial_records)").all().map((row) => String(row.name));
if (!financialColumns.includes("record_key")) {
  database.exec("DROP TABLE financial_records; CREATE TABLE financial_records (record_key TEXT PRIMARY KEY, id TEXT NOT NULL, company_id TEXT NOT NULL, report_year INTEGER NOT NULL, payload TEXT NOT NULL); CREATE INDEX idx_financial_company_year ON financial_records(company_id, report_year);");
}

function parse<T>(value: unknown): T { return JSON.parse(String(value)) as T; }
function payloadRows(table: string) { return database.prepare(`SELECT payload FROM ${table}`).all().map((row) => parse<JsonRecord>(row.payload)); }

function writeFullSnapshot(snapshot: SqliteSnapshot) {
  database.exec("BEGIN IMMEDIATE");
  try {
    for (const table of ["source_files", "field_catalogs", "financial_records", "company_year_scores", "company_industries", "esg_ratings", "violation_events"]) database.exec(`DELETE FROM ${table}`);
    const source = database.prepare("INSERT INTO source_files(id,payload) VALUES(?,?)");
    snapshot.files.forEach((item) => source.run(String(item.id), JSON.stringify(item)));
    const catalog = database.prepare("INSERT INTO field_catalogs(source_file_id,payload) VALUES(?,?)");
    snapshot.catalogs.forEach(([id, item]) => catalog.run(id, JSON.stringify(item)));
    const financial = database.prepare("INSERT INTO financial_records(record_key,id,company_id,report_year,payload) VALUES(?,?,?,?,?)");
    snapshot.financialRecords.forEach((item) => { const key = `${item.stockCode}:${item.fiscalPeriodEnd}:${item.reportType}:${item.sourceType}`; financial.run(key, String(item.id), String(item.companyId), Number(item.reportYear), JSON.stringify(item)); });
    const score = database.prepare("INSERT INTO company_year_scores(record_key,id,company_id,report_year,payload) VALUES(?,?,?,?,?)");
    snapshot.companyScores.forEach((item) => { const key = `${item.stockCode}:${item.reportYear}`; score.run(key, String(item.id), String(item.companyId), Number(item.reportYear), JSON.stringify(item)); });
    const industry = database.prepare("INSERT INTO company_industries(record_key,id,company_id,report_year,payload) VALUES(?,?,?,?,?)");
    snapshot.companyIndustries.forEach((item) => { const key = `${item.stockCode}:${item.reportYear}`; industry.run(key, String(item.id), String(item.companyId), Number(item.reportYear), JSON.stringify(item)); });
    const rating = database.prepare("INSERT INTO esg_ratings(record_key,id,vendor,company_id,report_year,payload) VALUES(?,?,?,?,?,?)");
    snapshot.esgRatings.forEach((item) => { const key = `${item.vendor}:${item.stockCode}:${item.reportYear}`; rating.run(key, String(item.id), String(item.vendor), String(item.companyId), Number(item.reportYear), JSON.stringify(item)); });
    const violation = database.prepare("INSERT INTO violation_events(id,company_id,year_from,year_to,payload) VALUES(?,?,?,?,?)");
    snapshot.violationEvents.forEach((item) => { const years = item.violationYears as number[]; violation.run(String(item.id), String(item.companyId), Math.min(...years), Math.max(...years), JSON.stringify(item)); });
    persistPdfState(snapshot);
    database.prepare("INSERT INTO metadata(key,value) VALUES('last_synced_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(snapshot.lastSyncedAt ?? "");
    database.exec("COMMIT");
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}

function migrateLegacySnapshot() {
  const count = Number((database.prepare("SELECT COUNT(*) AS count FROM financial_records").get() as { count: number }).count);
  if (count || !existsSync(legacySnapshotPath)) return;
  const legacy = parse<SqliteSnapshot>(readFileSync(legacySnapshotPath, "utf8"));
  writeFullSnapshot({ ...legacy, companyScores: legacy.companyScores ?? [], companyIndustries: legacy.companyIndustries ?? [], esgRatings: legacy.esgRatings ?? [], pdfDocuments: legacy.pdfDocuments ?? [], documentEvidence: legacy.documentEvidence ?? [], environmentalAspects: legacy.environmentalAspects ?? [] });
  database.prepare("INSERT INTO metadata(key,value) VALUES('legacy_json_migrated_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(new Date().toISOString());
}

migrateLegacySnapshot();
database.exec(`
  INSERT OR IGNORE INTO pdf_queue(fsid,filename,remote_path,size,md5,kind,status,queued_at,completed_at,updated_at,page_count,text_page_count,text_mode)
  SELECT fsid,source_label,'/remote/' || source_label,CAST(json_extract(payload,'$.size') AS INTEGER),json_extract(payload,'$.md5'),kind,'completed',
         json_extract(payload,'$.ingestedAt'),json_extract(payload,'$.ingestedAt'),json_extract(payload,'$.ingestedAt'),
         CAST(json_extract(payload,'$.pageCount') AS INTEGER),CAST(json_extract(payload,'$.textPageCount') AS INTEGER),text_mode
  FROM pdf_documents;
`);

type EvidenceLinkageMigrationStats = {
  normalizedRecords: number;
  remappedEvidenceYears: number;
  remappedDocumentYears: number;
  unresolvedEvidence: number;
  evidenceRecords: number;
  reaggregatedCompanyYears: number;
};

export function runEvidenceLinkageMigration(): EvidenceLinkageMigrationStats {
  const migrationKey = "evidence_linkage_keys_v2";
  const completed = database.prepare("SELECT value FROM metadata WHERE key=?").get(migrationKey) as { value?: string } | undefined;
  if (completed?.value) return parse<EvidenceLinkageMigrationStats>(completed.value);

  const scoreYears = new Map<string, number[]>();
  for (const row of database.prepare("SELECT company_id,report_year FROM company_year_scores").all()) {
    const companyId = normalizeCompanyId(row.company_id);
    if (!companyId) continue;
    const years = scoreYears.get(companyId) ?? [];
    years.push(Number(row.report_year));
    scoreYears.set(companyId, years);
  }

  const stats: EvidenceLinkageMigrationStats = {
    normalizedRecords: 0,
    remappedEvidenceYears: 0,
    remappedDocumentYears: 0,
    unresolvedEvidence: 0,
    evidenceRecords: 0,
    reaggregatedCompanyYears: 0,
  };
  const documentIdentity = new Map<string, { companyId: string | null; reportYear: number | null; kind: string }>();
  const updateDocument = database.prepare("UPDATE pdf_documents SET payload=? WHERE id=?");
  const updateEvidence = database.prepare("UPDATE evidence_items SET payload=? WHERE id=?");
  const updateAspect = database.prepare("UPDATE environmental_aspects SET payload=? WHERE id=?");

  database.exec("BEGIN IMMEDIATE");
  try {
    for (const row of database.prepare("SELECT id,source_label,payload FROM pdf_documents").all()) {
      const payload = parse<JsonRecord>(row.payload);
      const filename = String(payload.filename ?? row.source_label);
      const stockCode = normalizeStockCode(payload.stockCode ?? payload.companyId ?? filename);
      const companyId = normalizeCompanyId(stockCode);
      const originalYear = Number(payload.reportYear) || null;
      const inferredYear = inferReportYear("", filename);
      const reportYear = alignReportYearToScores(inferredYear ?? originalYear, companyId ? scoreYears.get(companyId) ?? [] : []);
      const publicationDate = inferPublicationDate(filename);
      documentIdentity.set(String(row.source_label), { companyId, reportYear, kind: String(payload.kind ?? "") });
      if (stockCode && payload.stockCode !== stockCode) { payload.stockCode = stockCode; stats.normalizedRecords += 1; }
      if (reportYear != null && reportYear !== originalYear) { payload.reportYear = reportYear; stats.remappedDocumentYears += 1; }
      if (publicationDate && payload.publicationDate !== publicationDate) payload.publicationDate = publicationDate;
      updateDocument.run(JSON.stringify(payload), String(row.id));
    }

    for (const row of database.prepare("SELECT id,source_label,payload FROM evidence_items").all()) {
      const payload = parse<JsonRecord>(row.payload);
      const document = documentIdentity.get(String(row.source_label));
      const companyId = document?.kind === "esg_report"
        ? document.companyId ?? normalizeCompanyId(payload.companyId)
        : normalizeCompanyId(payload.companyId) ?? document?.companyId ?? null;
      const originalYear = Number(payload.reportYear) || null;
      const plausibleOriginalYear = originalYear && originalYear >= 1990 && originalYear <= new Date().getFullYear() + 1 ? originalYear : null;
      const yearCandidate = document?.kind === "esg_report" ? document.reportYear : plausibleOriginalYear ?? document?.reportYear ?? null;
      const reportYear = alignReportYearToScores(yearCandidate, companyId ? scoreYears.get(companyId) ?? [] : []);
      if (!companyId || reportYear == null) stats.unresolvedEvidence += 1;
      if (companyId && payload.companyId !== companyId) { payload.companyId = companyId; stats.normalizedRecords += 1; }
      if (reportYear != null && reportYear !== Number(payload.reportYear)) { payload.reportYear = reportYear; stats.remappedEvidenceYears += 1; }
      updateEvidence.run(JSON.stringify(payload), String(row.id));
    }

    for (const row of database.prepare("SELECT id,payload FROM environmental_aspects").all()) {
      const payload = parse<JsonRecord>(row.payload);
      const companyId = normalizeCompanyId(payload.companyId);
      const originalYear = Number(payload.reportYear) || null;
      const reportYear = alignReportYearToScores(originalYear, companyId ? scoreYears.get(companyId) ?? [] : []);
      if (companyId && payload.companyId !== companyId) { payload.companyId = companyId; stats.normalizedRecords += 1; }
      if (reportYear != null && reportYear !== originalYear) payload.reportYear = reportYear;
      updateAspect.run(JSON.stringify(payload), String(row.id));
    }
    stats.evidenceRecords = Number((database.prepare("SELECT COUNT(*) AS count FROM evidence_items").get() as { count: number }).count);
    stats.reaggregatedCompanyYears = Number((database.prepare("SELECT COUNT(*) AS count FROM (SELECT json_extract(payload,'$.companyId'),json_extract(payload,'$.reportYear') FROM evidence_items GROUP BY 1,2)").get() as { count: number }).count);
    database.prepare("INSERT INTO metadata(key,value) VALUES(?,?)").run(migrationKey, JSON.stringify(stats));
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return stats;
}

export function loadSqliteSnapshot(): SqliteSnapshot {
  const documents = payloadRows("pdf_documents").map((document) => ({ ...document, pages: [] }));
  return {
    files: payloadRows("source_files"),
    catalogs: database.prepare("SELECT source_file_id,payload FROM field_catalogs").all().map((row) => [String(row.source_file_id), parse<JsonRecord>(row.payload)]),
    financialRecords: payloadRows("financial_records"), companyScores: payloadRows("company_year_scores"), companyIndustries: payloadRows("company_industries"), esgRatings: payloadRows("esg_ratings"), violationEvents: payloadRows("violation_events"), pdfDocuments: documents,
    documentEvidence: [], environmentalAspects: [],
    lastSyncedAt: (database.prepare("SELECT value FROM metadata WHERE key='last_synced_at'").get() as { value?: string } | undefined)?.value || undefined,
  };
}

export function persistFullSnapshot(snapshot: SqliteSnapshot) { writeFullSnapshot(snapshot); }

export function persistPdfState(snapshot: SqliteSnapshot) {
  const document = database.prepare("INSERT INTO pdf_documents(id,fsid,source_label,kind,text_mode,payload) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET fsid=excluded.fsid,source_label=excluded.source_label,kind=excluded.kind,text_mode=excluded.text_mode,payload=excluded.payload");
  const page = database.prepare("INSERT OR IGNORE INTO pdf_pages(document_id,page,text_hash,text) VALUES(?,?,?,?)");
  const evidence = database.prepare("INSERT INTO evidence_items(id,source_label,payload) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET source_label=excluded.source_label,payload=excluded.payload");
  const aspect = database.prepare("INSERT INTO environmental_aspects(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload");
  const queue = database.prepare("INSERT OR IGNORE INTO pdf_queue(fsid,filename,remote_path,size,md5,kind,status,queued_at,completed_at,updated_at,page_count,text_page_count,text_mode) VALUES(?,?,?,?,?,?,'completed',?,?,?,?,?,?)");
  const incomingSources = snapshot.pdfDocuments.filter((item) => (item.pages?.length ?? 0) > 0).map((item) => String(item.filename));
  const deleteEvidence = database.prepare("DELETE FROM evidence_items WHERE source_label=?");
  incomingSources.forEach((sourceLabel) => deleteEvidence.run(sourceLabel));
  for (const item of snapshot.pdfDocuments) {
    const { pages = [], ...metadata } = item;
    document.run(String(item.id), String(item.fsid), String(item.filename), String(item.kind), String(item.textMode), JSON.stringify(metadata));
    queue.run(String(item.fsid), String(item.filename), `/remote/${item.filename}`, Number(item.size), item.md5 ? String(item.md5) : null, String(item.kind), String(item.ingestedAt ?? new Date().toISOString()), String(item.ingestedAt ?? new Date().toISOString()), String(item.ingestedAt ?? new Date().toISOString()), Number(item.pageCount ?? 0), Number(item.textPageCount ?? 0), String(item.textMode));
    for (const itemPage of pages) page.run(String(item.id), Number(itemPage.page), String(itemPage.textHash), String(itemPage.text));
  }
  snapshot.documentEvidence.forEach((item) => evidence.run(String(item.id), String(item.sourceLabel), JSON.stringify(item)));
  snapshot.environmentalAspects.forEach((item) => aspect.run(String(item.id), JSON.stringify(item)));
  database.prepare("INSERT INTO metadata(key,value) VALUES('last_synced_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(snapshot.lastSyncedAt ?? "");
}

export function pdfDerivedSummary() {
  return {
    documentEvidenceCount: Number((database.prepare("SELECT COUNT(*) AS count FROM evidence_items").get() as { count: number }).count),
    environmentalAspectCount: Number((database.prepare("SELECT COUNT(*) AS count FROM environmental_aspects").get() as { count: number }).count),
  };
}

/** Lightweight table counts used as a cache-revision signal for live analysis. */
export function runtimeDataCounts() {
  const count = (table: string) => Number((database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
  return {
    evidenceItems: count("evidence_items"),
    environmentalAspects: count("environmental_aspects"),
    pdfDocuments: count("pdf_documents"),
    reviews: count("reviews"),
    evidenceRevision: (database.prepare("SELECT value FROM metadata WHERE key='evidence_linkage_keys_v2'").get() as { value?: string } | undefined)?.value ?? "none",
  };
}

export function persistedFailedPdfIdentities(): Array<{ companyId: string; reportYear: number }> {
  return database.prepare("SELECT filename FROM pdf_queue WHERE status='failed'").all().flatMap((row) => {
    const filename = String(row.filename);
    const companyId = normalizeCompanyId(filename);
    const reportYear = inferReportYear("", filename);
    return companyId && reportYear ? [{ companyId, reportYear }] : [];
  });
}

export interface PersistedEvidenceSummary {
  companyId: string;
  reportYear: number;
  total: number;
  implemented: number;
  planning: number;
  indeterminate: number;
  insufficient: number;
  unverifiedPlanning: number;
}

export function persistedPdfDocuments(): PdfDocumentRecord[] {
  return payloadRows("pdf_documents") as unknown as PdfDocumentRecord[];
}

export function persistedEvidenceSummaries(): PersistedEvidenceSummary[] {
  return database.prepare(`
    SELECT json_extract(payload,'$.companyId') AS company_id,
           CAST(json_extract(payload,'$.reportYear') AS INTEGER) AS report_year,
           COUNT(*) AS total,
           SUM(CASE WHEN json_extract(payload,'$.actionClass')='implemented' THEN 1 ELSE 0 END) AS implemented,
           SUM(CASE WHEN json_extract(payload,'$.actionClass')='planning' THEN 1 ELSE 0 END) AS planning,
           SUM(CASE WHEN json_extract(payload,'$.actionClass')='indeterminate' THEN 1 ELSE 0 END) AS indeterminate,
           SUM(CASE WHEN json_extract(payload,'$.status')='insufficient' THEN 1 ELSE 0 END) AS insufficient,
           SUM(CASE WHEN json_extract(payload,'$.actionClass')='planning' AND json_extract(payload,'$.status')='insufficient' THEN 1 ELSE 0 END) AS unverified_planning
      FROM evidence_items
     WHERE json_extract(payload,'$.companyId') IS NOT NULL
       AND json_extract(payload,'$.reportYear') IS NOT NULL
     GROUP BY company_id, report_year
  `).all().map((row) => ({
    companyId: String(row.company_id), reportYear: Number(row.report_year), total: Number(row.total),
    implemented: Number(row.implemented), planning: Number(row.planning), indeterminate: Number(row.indeterminate),
    insufficient: Number(row.insufficient), unverifiedPlanning: Number(row.unverified_planning),
  }));
}

export function persistedEvidenceItems(companyId: string, reportYear?: number): EvidenceItem[] {
  const rows = reportYear == null
    ? database.prepare("SELECT payload FROM evidence_items WHERE json_extract(payload,'$.companyId')=?").all(companyId)
    : database.prepare("SELECT payload FROM evidence_items WHERE json_extract(payload,'$.companyId')=? AND CAST(json_extract(payload,'$.reportYear') AS INTEGER)=?").all(companyId, reportYear);
  return rows.map((row) => {
    const item = parse<EvidenceItem>(row.payload);
    return { ...item, excerpt: item.excerpt ?? "" };
  });
}

export function allPersistedEvidenceItems(): EvidenceItem[] {
  return database.prepare("SELECT payload FROM evidence_items").all().map((row) => {
    const item = parse<EvidenceItem>(row.payload);
    return { ...item, excerpt: item.excerpt ?? "" };
  });
}

export function persistedEnvironmentalAspects(companyId?: string, reportYear?: number): EnvironmentalAspectScore[] {
  if (companyId && reportYear != null) {
    return database.prepare("SELECT payload FROM environmental_aspects WHERE json_extract(payload,'$.companyId')=? AND CAST(json_extract(payload,'$.reportYear') AS INTEGER)=?").all(companyId, reportYear).map((row) => parse<EnvironmentalAspectScore>(row.payload));
  }
  return payloadRows("environmental_aspects") as unknown as EnvironmentalAspectScore[];
}

export interface AspectEvidenceCoverage {
  category: string;
  total: number;
  covered: number;
}

export function aspectEvidenceCoverage(): AspectEvidenceCoverage[] {
  const statusByEvidenceId = new Map<string, string>();
  for (const row of database.prepare("SELECT id, json_extract(payload,'$.status') AS status FROM evidence_items").all()) {
    statusByEvidenceId.set(String(row.id), String(row.status ?? ""));
  }
  const buckets = new Map<string, { total: number; covered: number }>();
  for (const aspect of payloadRows("environmental_aspects")) {
    const category = aspect.category ? String(aspect.category) : "overall";
    const ids = Array.isArray(aspect.evidenceIds) ? aspect.evidenceIds.map(String) : [];
    const bucket = buckets.get(category) ?? { total: 0, covered: 0 };
    for (const id of ids) {
      bucket.total += 1;
      const status = statusByEvidenceId.get(id);
      if (status === "pending" || status === "verified") bucket.covered += 1;
    }
    buckets.set(category, bucket);
  }
  if (buckets.size) {
    return [...buckets.entries()].map(([category, bucket]) => ({ category, total: bucket.total, covered: bucket.covered }));
  }
  const summaries = persistedEvidenceSummaries();
  const total = summaries.reduce((sum, item) => sum + item.total, 0);
  const insufficient = summaries.reduce((sum, item) => sum + item.insufficient, 0);
  return [{ category: "overall", total, covered: total - insufficient }];
}

export function saveReviewRecord(review: ReviewRecord): ReviewRecord {
  const reviewedAt = review.reviewedAt ?? new Date().toISOString();
  const normalized: ReviewRecord = { ...review, reviewedAt };
  database.prepare(`
    INSERT INTO reviews(id,target_id,company_id,target_type,original_decision,human_decision,reason_code,note,reviewed_at,payload)
    VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      target_id=excluded.target_id,
      company_id=excluded.company_id,
      target_type=excluded.target_type,
      original_decision=excluded.original_decision,
      human_decision=excluded.human_decision,
      reason_code=excluded.reason_code,
      note=excluded.note,
      reviewed_at=excluded.reviewed_at,
      payload=excluded.payload
  `).run(normalized.id, normalized.targetId, normalized.companyId, normalized.targetType, normalized.originalDecision, normalized.humanDecision ?? null, normalized.reasonCode ?? null, normalized.note ?? null, reviewedAt, JSON.stringify(normalized));
  return normalized;
}

export function listReviewRecords(options: { targetType?: ReviewRecord["targetType"]; companyId?: string } = {}): ReviewRecord[] {
  const conditions: string[] = [];
  const params: SQLInputValue[] = [];
  if (options.targetType) { conditions.push("target_type=?"); params.push(options.targetType); }
  if (options.companyId) { conditions.push("company_id=?"); params.push(options.companyId); }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  return database.prepare(`SELECT payload FROM reviews${where} ORDER BY reviewed_at DESC`).all(...params).map((row) => parse<ReviewRecord>(row.payload));
}

export function createAnalysisJobRecord(input: { companyId: string; reportYear: number; fileName: string; fileSize: number }): AnalysisJob {
  const now = new Date().toISOString();
  const jobId = crypto.randomUUID();
  const job: AnalysisJob = { jobId, reportId: `report-${Date.now()}`, status: "queued", phase: "collect", progress: 0, resultCompanyId: input.companyId };
  database.prepare(`
    INSERT INTO analysis_jobs(job_id,report_id,company_id,report_year,file_name,file_size,status,phase,progress,result_company_id,error,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(jobId, job.reportId, input.companyId, input.reportYear, input.fileName, input.fileSize, job.status, job.phase, job.progress, job.resultCompanyId ?? null, null, now, now);
  return job;
}

function advanceAnalysisJob(stored: AnalysisJob, fileName: string, createdAt: string): AnalysisJob {
  const elapsed = Date.now() - Date.parse(createdAt);
  const lowerName = fileName.toLowerCase();
  if (elapsed >= 1_400 && (lowerName.includes("broken") || lowerName.includes("scan"))) {
    return {
      ...stored,
      status: "failed",
      phase: "extract",
      progress: 42,
      error: lowerName.includes("scan")
        ? { cause: "报告没有可解析文本层，可能是扫描件。", impact: "声明与行动证据尚未抽取，不能计算风险指标。", nextAction: "启用 OCR 后重新提交任务。" }
        : { cause: "报告文本层损坏或编码不可解析。", impact: "声明与行动证据尚未抽取，不能计算风险指标。", nextAction: "更换文本版 PDF，或启用 OCR 后重新提交任务。" },
    };
  }
  if (elapsed < 500) return { ...stored, status: "queued", phase: "collect", progress: 4 };
  if (elapsed < 1_000) return { ...stored, status: "running", phase: "collect", progress: 12 };
  if (elapsed < 1_500) return { ...stored, status: "running", phase: "preprocess", progress: 28 };
  if (elapsed < 2_000) return { ...stored, status: "running", phase: "extract", progress: 45 };
  if (elapsed < 2_500) return { ...stored, status: "running", phase: "classify", progress: 63 };
  if (elapsed < 3_000) return { ...stored, status: "running", phase: "calculate", progress: 81 };
  if (elapsed < 3_500) return { ...stored, status: "running", phase: "risk", progress: 94 };
  return { ...stored, status: "completed", phase: "risk", progress: 100 };
}

export function getAnalysisJobRecord(jobId: string): AnalysisJob | null {
  const row = database.prepare("SELECT job_id,report_id,company_id,report_year,file_name,file_size,status,phase,progress,result_company_id,error,created_at,updated_at FROM analysis_jobs WHERE job_id=?").get(jobId);
  if (!row) return null;
  const stored: AnalysisJob = {
    jobId: String(row.job_id),
    reportId: String(row.report_id),
    status: String(row.status) as AnalysisJob["status"],
    phase: String(row.phase) as AnalysisJob["phase"],
    progress: Number(row.progress),
    resultCompanyId: row.result_company_id ? String(row.result_company_id) : undefined,
    error: row.error ? parse<AnalysisJob["error"]>(row.error) : undefined,
  };
  const advanced = advanceAnalysisJob(stored, String(row.file_name), String(row.created_at));
  if (advanced.status !== stored.status || advanced.phase !== stored.phase || advanced.progress !== stored.progress || JSON.stringify(advanced.error) !== JSON.stringify(stored.error)) {
    database.prepare("UPDATE analysis_jobs SET status=?,phase=?,progress=?,error=?,updated_at=? WHERE job_id=?").run(advanced.status, advanced.phase, advanced.progress, advanced.error ? JSON.stringify(advanced.error) : null, new Date().toISOString(), jobId);
  }
  return advanced;
}

export function evidencePageText(companyId: string, evidenceId: string, page?: number): EvidencePageReference | null {
  const item = persistedEvidenceItems(companyId).find((entry) => entry.id === evidenceId);
  if (!item || !item.sourceLabel) return null;
  const document = database.prepare("SELECT id, payload FROM pdf_documents WHERE source_label=? ORDER BY json_extract(payload,'$.ingestedAt') DESC LIMIT 1").get(item.sourceLabel);
  if (!document) return null;
  const metadata = parse<PdfDocumentRecord>(document.payload);
  const resolvedPage = page ?? item.page;
  if (resolvedPage == null || resolvedPage < 1 || resolvedPage > metadata.pageCount) return null;
  const textRow = database.prepare("SELECT text FROM pdf_pages WHERE document_id=? AND page=?").get(String(document.id), resolvedPage);
  if (!textRow) return null;
  return {
    evidenceId: item.id,
    companyId,
    reportYear: item.reportYear,
    documentId: String(document.id),
    sourceLabel: item.sourceLabel,
    page: resolvedPage,
    pageCount: metadata.pageCount,
    text: String(textRow.text),
  };
}

export function stagePdfBatch(sessionId: string, documents: NetdiskPdfDocumentInput[], complete: boolean) {
  const now = new Date().toISOString();
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("INSERT INTO ingest_sessions(session_id,task_type,status,started_at,updated_at) VALUES(?,'pdf',?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at").run(sessionId, complete ? "finalizing" : "running", now, now);
    const item = database.prepare("INSERT INTO ingest_session_items(session_id,item_key,payload) VALUES(?,?,?) ON CONFLICT(session_id,item_key) DO UPDATE SET payload=excluded.payload");
    const page = database.prepare("INSERT OR IGNORE INTO ingest_session_pages(session_id,item_key,page,text_hash,text) VALUES(?,?,?,?,?)");
    let accepted = 0;
    for (const input of documents) {
      const key = `${input.fsid}:${input.filename}`; const { pages, ...metadata } = input;
      item.run(sessionId, key, JSON.stringify(metadata));
      pages.forEach((entry) => { page.run(sessionId, key, entry.page, entry.textHash, entry.text); accepted += 1; });
    }
    database.prepare("UPDATE ingest_sessions SET accepted_count=accepted_count+?,updated_at=? WHERE session_id=?").run(accepted, now, sessionId);
    database.exec("COMMIT"); return accepted;
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}

interface StagedExcelFile { fsid: string; filename: string; size: number; md5?: string; rows: JsonRecord[]; }
export function stageExcelBatch(sessionId: string, files: StagedExcelFile[], complete: boolean) {
  const now = new Date().toISOString(); database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("INSERT INTO ingest_sessions(session_id,task_type,status,started_at,updated_at) VALUES(?,'excel',?,?,?) ON CONFLICT(session_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at").run(sessionId, complete ? "finalizing" : "running", now, now);
    const item = database.prepare("INSERT INTO ingest_session_items(session_id,item_key,payload) VALUES(?,?,?) ON CONFLICT(session_id,item_key) DO UPDATE SET payload=excluded.payload");
    const rowInsert = database.prepare("INSERT INTO ingest_session_rows(session_id,item_key,row_index,payload) VALUES(?,?,?,?)");
    let accepted = 0;
    for (const file of files) {
      const key = `${file.fsid}:${file.filename}`; const { rows, ...metadata } = file; item.run(sessionId, key, JSON.stringify(metadata));
      const start = Number((database.prepare("SELECT COALESCE(MAX(row_index),-1)+1 AS next FROM ingest_session_rows WHERE session_id=? AND item_key=?").get(sessionId, key) as { next: number }).next);
      rows.forEach((entry, index) => { rowInsert.run(sessionId, key, start + index, JSON.stringify(entry)); accepted += 1; });
    }
    database.prepare("UPDATE ingest_sessions SET accepted_count=accepted_count+?,updated_at=? WHERE session_id=?").run(accepted, now, sessionId);
    database.exec("COMMIT"); return accepted;
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}

export function readStagedExcelSession(sessionId: string): StagedExcelFile[] {
  return database.prepare("SELECT item_key,payload FROM ingest_session_items WHERE session_id=?").all(sessionId).map((row) => ({ ...parse<Omit<StagedExcelFile, "rows">>(row.payload), rows: database.prepare("SELECT payload FROM ingest_session_rows WHERE session_id=? AND item_key=? ORDER BY row_index").all(sessionId, row.item_key).map((item) => parse<JsonRecord>(item.payload)) }));
}

export function readStagedPdfSession(sessionId: string): NetdiskPdfDocumentInput[] {
  return database.prepare("SELECT item_key,payload FROM ingest_session_items WHERE session_id=?").all(sessionId).map((row) => {
    const metadata = parse<Omit<NetdiskPdfDocumentInput, "pages">>(row.payload);
    const pages = database.prepare("SELECT page,text_hash,text FROM ingest_session_pages WHERE session_id=? AND item_key=? ORDER BY page").all(sessionId, row.item_key).map((item) => ({ page: Number(item.page), textHash: String(item.text_hash), text: String(item.text) }));
    return { ...metadata, pages };
  });
}

export function finishSession(sessionId: string, status: string, error?: JsonRecord) {
  database.prepare("UPDATE ingest_sessions SET status=?,error=?,updated_at=? WHERE session_id=?").run(status, error ? JSON.stringify(error) : null, new Date().toISOString(), sessionId);
  if (["completed", "completed_with_warnings"].includes(status)) {
    database.prepare("DELETE FROM ingest_session_pages WHERE session_id=?").run(sessionId);
    database.prepare("DELETE FROM ingest_session_items WHERE session_id=?").run(sessionId);
    database.prepare("DELETE FROM ingest_session_rows WHERE session_id=?").run(sessionId);
  }
}

export function readSessionStatus(sessionId: string) {
  const row = database.prepare("SELECT session_id,task_type,status,accepted_count,started_at,updated_at,error FROM ingest_sessions WHERE session_id=?").get(sessionId);
  if (!row) return null;
  return { sessionId: String(row.session_id), taskType: String(row.task_type), status: String(row.status), acceptedCount: Number(row.accepted_count), startedAt: String(row.started_at), updatedAt: String(row.updated_at), error: row.error ? parse<JsonRecord>(row.error) : undefined };
}

export function pdfQueueSummary() {
  const rows = database.prepare("SELECT status,COUNT(*) AS count FROM pdf_queue GROUP BY status").all();
  const counts = Object.fromEntries(rows.map((row) => [String(row.status), Number(row.count)]));
  const current = database.prepare("SELECT fsid,filename,attempts,started_at FROM pdf_queue WHERE status='running' ORDER BY started_at LIMIT 1").get();
  return { total: Object.values(counts).reduce((sum, value) => sum + value, 0), counts, current: current ?? null };
}
