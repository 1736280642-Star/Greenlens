import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AnalysisJob, CompanyScoreRecord, EnvironmentalAspectScore, EvidenceIdentityResolution, EvidenceItem, EvidencePageReference, EvidenceRebuildDocument, EvidenceReindexFunnel, EvidenceReindexRun, EvidenceReindexScope, GsiScoreRecord, NetdiskPdfDocumentInput, PdfDocumentKind, PdfDocumentRecord, PdfEvidenceJobStatus, ReviewQueueAction, ReviewRecord } from "@/types";
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

const globalDatabase = globalThis as typeof globalThis & { __greenlensSqlite?: DatabaseSync };
let database: DatabaseSync | null = null;

// Lazy handle: importing this module (as `next build` does while collecting
// route data) must not open the SQLite connection. The eager DatabaseSync + WAL
// bootstrap here previously kept static-generation workers alive after they
// finished, hanging `next build` before prerender-manifest.json was written.
function db(): DatabaseSync {
  if (!database) {
    if (process.env.NEXT_PHASE === "phase-production-build") {
      console.error("[DB-OPEN-DURING-BUILD]\n" + new Error().stack);
    }
    mkdirSync(path.dirname(databasePath), { recursive: true });
    database = globalDatabase.__greenlensSqlite ??= new DatabaseSync(databasePath);
    initializeSchema();
  }
  return database;
}
// Deferred schema + migration bootstrap, run once on first DB access.
function initializeSchema() {
  db().exec("PRAGMA busy_timeout = 30000;");
  db().exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS dashboard_cache (cache_key TEXT PRIMARY KEY, revision TEXT NOT NULL, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_dashboard_cache_updated ON dashboard_cache(updated_at);
  CREATE TABLE IF NOT EXISTS source_files (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS field_catalogs (source_file_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS financial_records (record_key TEXT PRIMARY KEY, id TEXT NOT NULL, company_id TEXT NOT NULL, report_year INTEGER NOT NULL, payload TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_financial_company_year ON financial_records(company_id, report_year);
  CREATE TABLE IF NOT EXISTS company_year_scores (record_key TEXT PRIMARY KEY, id TEXT NOT NULL, company_id TEXT NOT NULL, report_year INTEGER NOT NULL, payload TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_score_company_year ON company_year_scores(company_id, report_year);
  CREATE INDEX IF NOT EXISTS idx_score_year_company ON company_year_scores(report_year, company_id);
  CREATE TABLE IF NOT EXISTS gsi_scores (record_key TEXT PRIMARY KEY, id TEXT NOT NULL, company_id TEXT NOT NULL, report_year INTEGER NOT NULL, gsi_final REAL NOT NULL, payload TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_gsi_company_year ON gsi_scores(company_id, report_year);
  CREATE TABLE IF NOT EXISTS company_industries (record_key TEXT PRIMARY KEY, id TEXT NOT NULL, company_id TEXT NOT NULL, report_year INTEGER NOT NULL, payload TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_industry_company_year ON company_industries(company_id, report_year);
  CREATE INDEX IF NOT EXISTS idx_industry_year_name_company ON company_industries(report_year, COALESCE(NULLIF(json_extract(payload,'$.industryGroup'),''), NULLIF(json_extract(payload,'$.industryName'),''), '未分类'), company_id);
  CREATE TABLE IF NOT EXISTS esg_ratings (record_key TEXT PRIMARY KEY, id TEXT NOT NULL, vendor TEXT NOT NULL, company_id TEXT NOT NULL, report_year INTEGER NOT NULL, payload TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_esg_rating_company_year ON esg_ratings(company_id, report_year);
  CREATE INDEX IF NOT EXISTS idx_esg_rating_vendor ON esg_ratings(vendor);
  CREATE TABLE IF NOT EXISTS violation_events (id TEXT PRIMARY KEY, company_id TEXT NOT NULL, year_from INTEGER, year_to INTEGER, payload TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_violation_company_year ON violation_events(company_id, year_from, year_to);
  CREATE TABLE IF NOT EXISTS pdf_documents (id TEXT PRIMARY KEY, fsid TEXT NOT NULL, source_label TEXT NOT NULL, kind TEXT NOT NULL, text_mode TEXT NOT NULL, payload TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_pdf_stock_code ON pdf_documents(json_extract(payload,'$.stockCode'));
  CREATE INDEX IF NOT EXISTS idx_pdf_stock_year ON pdf_documents(json_extract(payload,'$.stockCode'), CAST(json_extract(payload,'$.reportYear') AS INTEGER));
  CREATE TABLE IF NOT EXISTS pdf_pages (document_id TEXT NOT NULL, page INTEGER NOT NULL, text_hash TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY(document_id, page, text_hash));
  CREATE INDEX IF NOT EXISTS idx_pdf_pages_document ON pdf_pages(document_id, page);
  CREATE TABLE IF NOT EXISTS evidence_items (id TEXT PRIMARY KEY, source_label TEXT NOT NULL, company_id TEXT, report_year INTEGER, action_class TEXT, status TEXT, payload TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_evidence_source_label ON evidence_items(source_label);
  CREATE INDEX IF NOT EXISTS idx_evidence_document ON evidence_items(json_extract(payload,'$.documentId'));
  CREATE INDEX IF NOT EXISTS idx_evidence_company_year ON evidence_items(company_id, report_year, id);
  CREATE TABLE IF NOT EXISTS environmental_aspects (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_aspects_company_year ON environmental_aspects(json_extract(payload,'$.companyId'), CAST(json_extract(payload,'$.reportYear') AS INTEGER));
  CREATE INDEX IF NOT EXISTS idx_aspects_document ON environmental_aspects(json_extract(payload,'$.documentId'));
  CREATE TABLE IF NOT EXISTS ingest_sessions (session_id TEXT PRIMARY KEY, task_type TEXT NOT NULL, status TEXT NOT NULL, accepted_count INTEGER NOT NULL DEFAULT 0, started_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT);
  CREATE TABLE IF NOT EXISTS ingest_session_items (session_id TEXT NOT NULL, item_key TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(session_id, item_key));
  CREATE TABLE IF NOT EXISTS ingest_session_rows (session_id TEXT NOT NULL, item_key TEXT NOT NULL, row_index INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(session_id, item_key, row_index));
  CREATE TABLE IF NOT EXISTS ingest_session_pages (session_id TEXT NOT NULL, item_key TEXT NOT NULL, page INTEGER NOT NULL, text_hash TEXT NOT NULL, text TEXT NOT NULL, PRIMARY KEY(session_id, item_key, page, text_hash));
  CREATE TABLE IF NOT EXISTS pdf_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT, fsid TEXT NOT NULL UNIQUE, filename TEXT NOT NULL, remote_path TEXT NOT NULL,
    size INTEGER NOT NULL, md5 TEXT, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT, page_count INTEGER, text_page_count INTEGER, text_mode TEXT, queued_at TEXT NOT NULL, started_at TEXT, completed_at TEXT, updated_at TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'netdisk_pdf', archive_fsid TEXT, member_path TEXT,
    next_attempt_at TEXT, failure_category TEXT, failure_stage TEXT, failure_detail TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_pdf_queue_status ON pdf_queue(status, id);
  CREATE TABLE IF NOT EXISTS archive_circuits (
    archive_fsid TEXT PRIMARY KEY, consecutive_failures INTEGER NOT NULL DEFAULT 0,
    open_until TEXT, last_category TEXT, updated_at TEXT NOT NULL
  );
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
  CREATE TABLE IF NOT EXISTS review_queue_actions (
    task_id TEXT PRIMARY KEY,
    id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    action TEXT NOT NULL,
    acted_at TEXT NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_review_queue_actions_acted_at ON review_queue_actions(acted_at);
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
  CREATE TABLE IF NOT EXISTS pdf_evidence_jobs (
    document_id TEXT PRIMARY KEY,
    run_id TEXT,
    status TEXT NOT NULL,
    identity_status TEXT NOT NULL,
    linkage_status TEXT NOT NULL,
    extractor_version TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    evidence_count INTEGER NOT NULL DEFAULT 0,
    error_code TEXT,
    error_detail TEXT,
    resolved_company_id TEXT,
    resolved_stock_code TEXT,
    report_year INTEGER,
    identity_confidence REAL,
    year_confidence REAL,
    identity_sources TEXT,
    alternative_candidates TEXT,
    started_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pdf_evidence_jobs_status ON pdf_evidence_jobs(status,document_id);
  CREATE TABLE IF NOT EXISTS evidence_reindex_runs (
    job_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    scope TEXT NOT NULL,
    kind TEXT NOT NULL,
    extractor_version TEXT NOT NULL,
    total_candidates INTEGER NOT NULL DEFAULT 0,
    processed INTEGER NOT NULL DEFAULT 0,
    succeeded INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0,
    cursor TEXT,
    started_at TEXT,
    completed_at TEXT,
    updated_at TEXT NOT NULL,
    error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_evidence_reindex_runs_status ON evidence_reindex_runs(status,updated_at);
`);

// Concurrent build/worker processes may add a column between the PRAGMA guard
// above and the ALTER below; tolerate that benign "duplicate column name" race.
function addColumnIfMissing(table: string, column: string, definition: string) {
  try {
    db().exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (error) {
    if (!(error instanceof Error) || !/duplicate column name/i.test(error.message)) throw error;
  }
}

// Materialize the hot json_extract fields as real columns so evidence aggregation
// skips a full JSON parse over ~800k rows on every cold dashboard request.
const evidenceColumnDefinitions: Record<string, string> = {
  company_id: "TEXT",
  report_year: "INTEGER",
  action_class: "TEXT",
  status: "TEXT",
};
const existingEvidenceColumns = new Set(db().prepare("PRAGMA table_info(evidence_items)").all().map((row) => String(row.name)));
if ([...Object.keys(evidenceColumnDefinitions)].some((column) => !existingEvidenceColumns.has(column))) {
  db().exec("DROP INDEX IF EXISTS idx_evidence_company_year;");
  for (const [column, definition] of Object.entries(evidenceColumnDefinitions)) {
    if (!existingEvidenceColumns.has(column)) addColumnIfMissing("evidence_items", column, definition);
  }
  db().exec("BEGIN IMMEDIATE;");
  try {
    db().exec(`
      UPDATE evidence_items SET
        company_id = json_extract(payload,'$.companyId'),
        report_year = CAST(json_extract(payload,'$.reportYear') AS INTEGER),
        action_class = json_extract(payload,'$.actionClass'),
        status = json_extract(payload,'$.status');
    `);
    db().exec("COMMIT;");
  } catch (error) {
    db().exec("ROLLBACK;");
    throw error;
  }
}
// Re-establish the materialized-column indexes once the columns are guaranteed to exist.
function ensureIndexShape(table: string, index: string, wanted: string[]) {
  const info = db().prepare(`PRAGMA index_info(${index})`).all()
    .map((row) => row.name).filter((name) => name != null);
  if (info.length !== wanted.length || wanted.some((column, position) => info[position] !== column)) {
    db().exec(`DROP INDEX IF EXISTS ${index};`);
    db().exec(`CREATE INDEX IF NOT EXISTS ${index} ON ${table}(${wanted.join(", ")});`);
  }
}
ensureIndexShape("evidence_items", "idx_evidence_company_year", ["company_id", "report_year", "id"]);
ensureIndexShape("evidence_items", "idx_evidence_summary", ["company_id", "report_year", "action_class", "status"]);
const financialColumns = db().prepare("PRAGMA table_info(financial_records)").all().map((row) => String(row.name));
if (!financialColumns.includes("record_key")) {
  db().exec("DROP TABLE financial_records; CREATE TABLE financial_records (record_key TEXT PRIMARY KEY, id TEXT NOT NULL, company_id TEXT NOT NULL, report_year INTEGER NOT NULL, payload TEXT NOT NULL); CREATE INDEX idx_financial_company_year ON financial_records(company_id, report_year);");
}
const pdfQueueColumns = new Set(db().prepare("PRAGMA table_info(pdf_queue)").all().map((row) => String(row.name)));
const pdfQueueMigrations: Record<string, string> = {
  source_type: "TEXT NOT NULL DEFAULT 'netdisk_pdf'",
  archive_fsid: "TEXT",
  member_path: "TEXT",
  next_attempt_at: "TEXT",
  failure_category: "TEXT",
  failure_stage: "TEXT",
  failure_detail: "TEXT",
};
for (const [column, definition] of Object.entries(pdfQueueMigrations)) {
  if (!pdfQueueColumns.has(column)) addColumnIfMissing("pdf_queue", column, definition);
}
const analysisJobColumns = new Set(db().prepare("PRAGMA table_info(analysis_jobs)").all().map((row) => String(row.name)));
const analysisJobMigrations: Record<string, string> = {
  document_id: "TEXT",
  file_hash: "TEXT",
  storage_path: "TEXT",
  mime_type: "TEXT",
  attempts: "INTEGER NOT NULL DEFAULT 1",
  cancel_requested: "INTEGER NOT NULL DEFAULT 0",
  started_at: "TEXT",
  completed_at: "TEXT",
  payload: "TEXT",
};
for (const [column, definition] of Object.entries(analysisJobMigrations)) {
  if (!analysisJobColumns.has(column)) addColumnIfMissing("analysis_jobs", column, definition);
}
db().exec("CREATE INDEX IF NOT EXISTS idx_analysis_jobs_hash ON analysis_jobs(file_hash,company_id,report_year,status);");
db().exec(`
  CREATE INDEX IF NOT EXISTS idx_pdf_queue_retry ON pdf_queue(status,next_attempt_at,id);
  UPDATE pdf_queue SET
    failure_category = CASE
      WHEN error LIKE 'The ZIP download%untrusted host%' THEN 'zip_redirect_untrusted'
      WHEN error='File is not a zip file' THEN 'zip_range_response_invalid'
      WHEN error LIKE 'ZIP PDF ingestion failed%' THEN 'zip_ingest_unknown'
      WHEN error='No readable PDFs were available for ingestion.' THEN 'source_unavailable'
      WHEN error LIKE 'GreenLens rejected%' THEN 'backend_unavailable'
      ELSE 'unclassified'
    END,
    failure_stage = CASE
      WHEN source_type='netdisk_zip_pdf' THEN 'zip_download'
      WHEN error LIKE 'GreenLens rejected%' THEN 'backend_publish'
      ELSE 'source_download'
    END,
    failure_detail = COALESCE(failure_detail,error)
  WHERE status='failed' AND failure_category IS NULL;
  `);

  migrateLegacySnapshot();
  db().exec(`
  INSERT OR IGNORE INTO pdf_queue(fsid,filename,remote_path,size,md5,kind,status,queued_at,completed_at,updated_at,page_count,text_page_count,text_mode)
  SELECT fsid,source_label,'/remote/' || source_label,CAST(json_extract(payload,'$.size') AS INTEGER),json_extract(payload,'$.md5'),kind,'completed',
         json_extract(payload,'$.ingestedAt'),json_extract(payload,'$.ingestedAt'),json_extract(payload,'$.ingestedAt'),
         CAST(json_extract(payload,'$.pageCount') AS INTEGER),CAST(json_extract(payload,'$.textPageCount') AS INTEGER),text_mode
  FROM pdf_documents;
  `);
}

function parse<T>(value: unknown): T { return JSON.parse(String(value)) as T; }
function payloadRows(table: string) { return db().prepare(`SELECT payload FROM ${table}`).all().map((row) => parse<JsonRecord>(row.payload)); }

function evidenceColumnValues(item: { companyId?: unknown; reportYear?: unknown; actionClass?: unknown; status?: unknown }) {
  const companyId = item.companyId != null ? String(item.companyId) : null;
  const reportYearRaw = item.reportYear;
  const reportYear = reportYearRaw != null && reportYearRaw !== "" ? Number(reportYearRaw) || null : null;
  const actionClass = item.actionClass != null ? String(item.actionClass) : null;
  const status = item.status != null ? String(item.status) : null;
  return { companyId, reportYear, actionClass, status };
}

function writeFullSnapshot(snapshot: SqliteSnapshot) {
  db().exec("BEGIN IMMEDIATE");
  try {
    for (const table of ["source_files", "field_catalogs", "financial_records", "company_year_scores", "company_industries", "esg_ratings", "violation_events"]) db().exec(`DELETE FROM ${table}`);
    const source = db().prepare("INSERT INTO source_files(id,payload) VALUES(?,?)");
    snapshot.files.forEach((item) => source.run(String(item.id), JSON.stringify(item)));
    const catalog = db().prepare("INSERT INTO field_catalogs(source_file_id,payload) VALUES(?,?)");
    snapshot.catalogs.forEach(([id, item]) => catalog.run(id, JSON.stringify(item)));
    const financial = db().prepare("INSERT INTO financial_records(record_key,id,company_id,report_year,payload) VALUES(?,?,?,?,?)");
    snapshot.financialRecords.forEach((item) => { const key = `${item.stockCode}:${item.fiscalPeriodEnd}:${item.reportType}:${item.sourceType}`; financial.run(key, String(item.id), String(item.companyId), Number(item.reportYear), JSON.stringify(item)); });
    const score = db().prepare("INSERT INTO company_year_scores(record_key,id,company_id,report_year,payload) VALUES(?,?,?,?,?)");
    snapshot.companyScores.forEach((item) => { const key = `${item.stockCode}:${item.reportYear}`; score.run(key, String(item.id), String(item.companyId), Number(item.reportYear), JSON.stringify(item)); });
    const industry = db().prepare("INSERT INTO company_industries(record_key,id,company_id,report_year,payload) VALUES(?,?,?,?,?)");
    snapshot.companyIndustries.forEach((item) => { const key = `${item.stockCode}:${item.reportYear}`; industry.run(key, String(item.id), String(item.companyId), Number(item.reportYear), JSON.stringify(item)); });
    const rating = db().prepare("INSERT INTO esg_ratings(record_key,id,vendor,company_id,report_year,payload) VALUES(?,?,?,?,?,?)");
    snapshot.esgRatings.forEach((item) => { const key = `${item.vendor}:${item.stockCode}:${item.reportYear}`; rating.run(key, String(item.id), String(item.vendor), String(item.companyId), Number(item.reportYear), JSON.stringify(item)); });
    const violation = db().prepare("INSERT INTO violation_events(id,company_id,year_from,year_to,payload) VALUES(?,?,?,?,?)");
    snapshot.violationEvents.forEach((item) => { const years = item.violationYears as number[]; violation.run(String(item.id), String(item.companyId), Math.min(...years), Math.max(...years), JSON.stringify(item)); });
    persistPdfState(snapshot, false);
    db().prepare("INSERT INTO metadata(key,value) VALUES('last_synced_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(snapshot.lastSyncedAt ?? "");
    db().exec("COMMIT");
  } catch (error) { db().exec("ROLLBACK"); throw error; }
}

function migrateLegacySnapshot() {
  if (process.env.GREENLENS_DISABLE_LEGACY_MIGRATION === "1") return;
  const count = Number((db().prepare("SELECT COUNT(*) AS count FROM financial_records").get() as { count: number }).count);
  if (count || !existsSync(legacySnapshotPath)) return;
  const legacy = parse<SqliteSnapshot>(readFileSync(legacySnapshotPath, "utf8"));
  writeFullSnapshot({ ...legacy, companyScores: legacy.companyScores ?? [], companyIndustries: legacy.companyIndustries ?? [], esgRatings: legacy.esgRatings ?? [], pdfDocuments: legacy.pdfDocuments ?? [], documentEvidence: legacy.documentEvidence ?? [], environmentalAspects: legacy.environmentalAspects ?? [] });
  db().prepare("INSERT INTO metadata(key,value) VALUES('legacy_json_migrated_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(new Date().toISOString());
}

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
  const completed = db().prepare("SELECT value FROM metadata WHERE key=?").get(migrationKey) as { value?: string } | undefined;
  if (completed?.value) return parse<EvidenceLinkageMigrationStats>(completed.value);

  const scoreYears = new Map<string, number[]>();
  for (const row of db().prepare("SELECT company_id,report_year FROM company_year_scores").all()) {
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
  const updateDocument = db().prepare("UPDATE pdf_documents SET payload=? WHERE id=?");
  const updateEvidence = db().prepare("UPDATE evidence_items SET company_id=?, report_year=?, action_class=?, status=?, payload=? WHERE id=?");
  const updateAspect = db().prepare("UPDATE environmental_aspects SET payload=? WHERE id=?");

  db().exec("BEGIN IMMEDIATE");
  try {
    for (const row of db().prepare("SELECT id,source_label,payload FROM pdf_documents").all()) {
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

    for (const row of db().prepare("SELECT id,source_label,payload FROM evidence_items").all()) {
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
      const columns = evidenceColumnValues(payload);
      updateEvidence.run(columns.companyId, columns.reportYear, columns.actionClass, columns.status, JSON.stringify(payload), String(row.id));
    }

    for (const row of db().prepare("SELECT id,payload FROM environmental_aspects").all()) {
      const payload = parse<JsonRecord>(row.payload);
      const companyId = normalizeCompanyId(payload.companyId);
      const originalYear = Number(payload.reportYear) || null;
      const reportYear = alignReportYearToScores(originalYear, companyId ? scoreYears.get(companyId) ?? [] : []);
      if (companyId && payload.companyId !== companyId) { payload.companyId = companyId; stats.normalizedRecords += 1; }
      if (reportYear != null && reportYear !== originalYear) payload.reportYear = reportYear;
      updateAspect.run(JSON.stringify(payload), String(row.id));
    }
    stats.evidenceRecords = Number((db().prepare("SELECT COUNT(*) AS count FROM evidence_items").get() as { count: number }).count);
    stats.reaggregatedCompanyYears = Number((db().prepare("SELECT COUNT(*) AS count FROM (SELECT json_extract(payload,'$.companyId'),json_extract(payload,'$.reportYear') FROM evidence_items GROUP BY 1,2)").get() as { count: number }).count);
    db().prepare("INSERT INTO metadata(key,value) VALUES(?,?)").run(migrationKey, JSON.stringify(stats));
    db().exec("COMMIT");
  } catch (error) {
    db().exec("ROLLBACK");
    throw error;
  }
  return stats;
}

export function loadSqliteSnapshot(): SqliteSnapshot {
  const documents = payloadRows("pdf_documents").map((document) => ({ ...document, pages: [] }));
  return {
    files: payloadRows("source_files"),
    catalogs: db().prepare("SELECT source_file_id,payload FROM field_catalogs").all().map((row) => [String(row.source_file_id), parse<JsonRecord>(row.payload)]),
    financialRecords: payloadRows("financial_records"), companyScores: payloadRows("company_year_scores"), companyIndustries: payloadRows("company_industries"), esgRatings: payloadRows("esg_ratings"), violationEvents: payloadRows("violation_events"), pdfDocuments: documents,
    documentEvidence: [], environmentalAspects: [],
    lastSyncedAt: (db().prepare("SELECT value FROM metadata WHERE key='last_synced_at'").get() as { value?: string } | undefined)?.value || undefined,
  };
}

export interface DashboardSqliteQuery {
  year?: number;
  industry?: string;
  riskBand?: string;
  sampleGroup?: string;
}


export interface DashboardSqliteSnapshot extends SqliteSnapshot {
  resolvedYear: number;
  selectedCompanyIds: string[];
}

export interface DashboardScoreHistoryRow {
  companyId: string;
  reportYear: number;
  riskLevel: string;
  eass: number | null;
  ir: number | null;
  upr: number | null;
  esgsiRaw: number | null;
  esgsiNorm: number | null;
  eaaEsiRaw: number | null;
  eaaEsiNorm: number | null;
  environmentalSentenceCount: number;
  duplicateCount: number;
  sampleGroup: string;
  qualityFlagCount: number;
}

export interface DashboardConstellationRow {
  companyId: string;
  companyName: string;
  stockCode: string;
  industry: string;
  reportYear: number;
  esgsi: number | null;
  eass: number | null;
  finalIndex: number | null;
  riskBand: "high" | "medium" | "low" | "unavailable";
}

export function loadDashboardConstellationRows(query: DashboardSqliteQuery = {}): DashboardConstellationRow[] {
  const availableYears = db().prepare("SELECT DISTINCT report_year FROM company_year_scores ORDER BY report_year DESC").all().map((row) => Number(row.report_year));
  const resolvedYear = query.year != null && availableYears.includes(query.year) ? query.year : availableYears[0] ?? new Date().getFullYear();
  const riskSql = `CASE
    WHEN LOWER(CAST(json_extract(s.payload,'$.riskLevel') AS TEXT)) LIKE '%high%' THEN 'high'
    WHEN LOWER(CAST(json_extract(s.payload,'$.riskLevel') AS TEXT)) LIKE '%medium%' THEN 'medium'
    WHEN LOWER(CAST(json_extract(s.payload,'$.riskLevel') AS TEXT)) LIKE '%low%' THEN 'low'
    ELSE 'unavailable' END`;
  const conditions = ["s.report_year=?"];
  const params: SQLInputValue[] = [resolvedYear];
  if (query.industry && query.industry !== "全部行业") {
    conditions.push(`EXISTS (SELECT 1 FROM company_industries i WHERE i.company_id=s.company_id AND i.report_year=s.report_year AND COALESCE(NULLIF(json_extract(i.payload,'$.industryGroup'),''),NULLIF(json_extract(i.payload,'$.industryName'),''),'未分类')=?)`);
    params.push(query.industry);
  }
  if (query.riskBand) { conditions.push(`${riskSql}=?`); params.push(query.riskBand); }
  if (query.sampleGroup) { conditions.push("json_extract(s.payload,'$.sampleGroup')=?"); params.push(query.sampleGroup); }
  return db().prepare(`
    SELECT s.company_id,s.report_year,
           COALESCE(json_extract(s.payload,'$.companyName'),s.company_id) AS company_name,
           COALESCE(json_extract(s.payload,'$.stockCode'),'—') AS stock_code,
           COALESCE((SELECT COALESCE(NULLIF(json_extract(i.payload,'$.industryGroup'),''),NULLIF(json_extract(i.payload,'$.industryName'),''),'未分类') FROM company_industries i WHERE i.company_id=s.company_id AND i.report_year=s.report_year LIMIT 1),'未分类') AS industry,
           COALESCE(json_extract(s.payload,'$.esgsiNorm'),json_extract(s.payload,'$.esgsiRaw')) AS esgsi,
           json_extract(s.payload,'$.EASS') AS eass,
           COALESCE(json_extract(s.payload,'$.eaaEsiNorm'),json_extract(s.payload,'$.eaaEsiRaw')) AS final_index,
           ${riskSql} AS risk_band
      FROM company_year_scores s
     WHERE ${conditions.join(" AND ")}
     ORDER BY s.company_id
  `).all(...params).map((row) => ({
    companyId: String(row.company_id), companyName: String(row.company_name), stockCode: String(row.stock_code), industry: String(row.industry),
    reportYear: Number(row.report_year), esgsi: row.esgsi == null ? null : Number(row.esgsi), eass: row.eass == null ? null : Number(row.eass),
    finalIndex: row.final_index == null ? null : Number(row.final_index), riskBand: String(row.risk_band) as DashboardConstellationRow["riskBand"],
  }));
}

function payloadRowsForCompanyIds(table: string, companyIds: string[], extraWhere = "", extraParams: SQLInputValue[] = []) {
  if (!companyIds.length) return [];
  const rows: JsonRecord[] = [];
  for (let offset = 0; offset < companyIds.length; offset += 400) {
    const ids = companyIds.slice(offset, offset + 400);
    const placeholders = ids.map(() => "?").join(",");
    const statement = db().prepare(`SELECT payload FROM ${table} WHERE company_id IN (${placeholders}) ${extraWhere}`);
    rows.push(...statement.all(...ids, ...extraParams).map((row) => parse<JsonRecord>(row.payload)));
  }
  return rows;
}

/**
 * Load only the current filtered cohort and its history. This avoids parsing
 * the multi-gigabyte financial table into the long-lived Next.js process.
 */
export function loadDashboardSqliteSnapshot(query: DashboardSqliteQuery = {}): DashboardSqliteSnapshot {
  const yearRows = db().prepare("SELECT DISTINCT report_year FROM company_year_scores ORDER BY report_year DESC").all();
  const availableYears = yearRows.map((row) => Number(row.report_year)).filter(Number.isFinite);
  const resolvedYear = query.year != null && availableYears.includes(query.year)
    ? query.year
    : availableYears[0] ?? new Date().getFullYear();
  const conditions = ["s.report_year=?"];
  const params: SQLInputValue[] = [resolvedYear];
  if (query.industry && query.industry !== "全部行业") {
    conditions.push(`EXISTS (
      SELECT 1 FROM company_industries i
       WHERE i.company_id=s.company_id AND i.report_year=s.report_year
         AND COALESCE(NULLIF(json_extract(i.payload,'$.industryGroup'),''), NULLIF(json_extract(i.payload,'$.industryName'),''), '未分类')=?
    )`);
    params.push(query.industry);
  }
  if (query.riskBand) {
    conditions.push(`CASE
      WHEN LOWER(CAST(json_extract(s.payload,'$.riskLevel') AS TEXT)) LIKE '%high%' THEN 'high'
      WHEN LOWER(CAST(json_extract(s.payload,'$.riskLevel') AS TEXT)) LIKE '%medium%' THEN 'medium'
      WHEN LOWER(CAST(json_extract(s.payload,'$.riskLevel') AS TEXT)) LIKE '%low%' THEN 'low'
      ELSE 'unavailable' END = ?`);
    params.push(query.riskBand);
  }
  if (query.sampleGroup) {
    conditions.push("json_extract(s.payload,'$.sampleGroup')=?");
    params.push(query.sampleGroup);
  }
  const selectedScores = db().prepare(`SELECT s.payload FROM company_year_scores s WHERE ${conditions.join(" AND ")}`)
    .all(...params).map((row) => parse<JsonRecord>(row.payload));
  const selectedCompanyIds = [...new Set(selectedScores.map((score) => String(score.companyId)))];
  const selectedStockCodes = [...new Set(selectedScores.map((score) => String(score.stockCode)))];
  const companyScores = selectedScores;
  const financialRecords = payloadRowsForCompanyIds("financial_records", selectedCompanyIds, "AND report_year=? AND json_extract(payload,'$.fiscalPeriodEnd') LIKE '%-12-31' AND json_extract(payload,'$.reportType')='A'", [resolvedYear]);
  const companyIndustries = payloadRowsForCompanyIds("company_industries", selectedCompanyIds, "AND report_year=?", [resolvedYear]);
  const violationEvents = payloadRowsForCompanyIds("violation_events", selectedCompanyIds, "AND (year_from IS NULL OR year_from<=?) AND (year_to IS NULL OR year_to>=?)", [resolvedYear, resolvedYear]);
  const pdfDocuments: JsonRecord[] = [];
  for (let offset = 0; offset < selectedStockCodes.length; offset += 400) {
    const codes = selectedStockCodes.slice(offset, offset + 400);
    const placeholders = codes.map(() => "?").join(",");
    pdfDocuments.push(...db().prepare(`SELECT payload FROM pdf_documents WHERE json_extract(payload,'$.stockCode') IN (${placeholders}) AND CAST(json_extract(payload,'$.reportYear') AS INTEGER)=?`).all(...codes, resolvedYear).map((row) => parse<JsonRecord>(row.payload)));
  }
  return {
    files: [], catalogs: [], financialRecords, companyScores, companyIndustries,
    esgRatings: [], violationEvents, pdfDocuments: pdfDocuments.map((document) => ({ ...document, pages: [] })),
    documentEvidence: [], environmentalAspects: [], resolvedYear, selectedCompanyIds,
  };
}

export function loadDashboardScoreHistoryRows(companyIds: string[], maxYear: number): DashboardScoreHistoryRow[] {
  if (!companyIds.length) return [];
  const rows: DashboardScoreHistoryRow[] = [];
  for (let offset = 0; offset < companyIds.length; offset += 400) {
    const ids = companyIds.slice(offset, offset + 400);
    const placeholders = ids.map(() => "?").join(",");
    const projected = db().prepare(`
      SELECT company_id,report_year,
             json_extract(payload,'$.riskLevel') AS risk_level,
             json_extract(payload,'$.EASS') AS eass,
             json_extract(payload,'$.IR') AS ir,
             json_extract(payload,'$.UPR') AS upr,
             json_extract(payload,'$.esgsiRaw') AS esgsi_raw,
             json_extract(payload,'$.esgsiNorm') AS esgsi_norm,
             json_extract(payload,'$.eaaEsiRaw') AS eaa_esi_raw,
             json_extract(payload,'$.eaaEsiNorm') AS eaa_esi_norm,
             COALESCE(json_extract(payload,'$.nEnvironmentalSentences'),0) AS environmental_sentence_count,
             COALESCE(json_extract(payload,'$.duplicateCount'),1) AS duplicate_count,
             COALESCE(json_extract(payload,'$.sampleGroup'),'low_n_lt_10') AS sample_group,
             COALESCE(json_array_length(json_extract(payload,'$.qualityFlags')),0) AS quality_flag_count
        FROM company_year_scores
       WHERE company_id IN (${placeholders}) AND report_year<=?
    `).all(...ids, maxYear);
    rows.push(...projected.map((row) => ({
      companyId: String(row.company_id), reportYear: Number(row.report_year), riskLevel: String(row.risk_level ?? ""),
      eass: row.eass == null ? null : Number(row.eass), ir: row.ir == null ? null : Number(row.ir), upr: row.upr == null ? null : Number(row.upr),
      esgsiRaw: row.esgsi_raw == null ? null : Number(row.esgsi_raw), esgsiNorm: row.esgsi_norm == null ? null : Number(row.esgsi_norm),
      eaaEsiRaw: row.eaa_esi_raw == null ? null : Number(row.eaa_esi_raw), eaaEsiNorm: row.eaa_esi_norm == null ? null : Number(row.eaa_esi_norm),
      environmentalSentenceCount: Number(row.environmental_sentence_count), duplicateCount: Number(row.duplicate_count),
      sampleGroup: String(row.sample_group), qualityFlagCount: Number(row.quality_flag_count),
    })));
  }
  return rows;
}

export function persistFullSnapshot(snapshot: SqliteSnapshot) { writeFullSnapshot(snapshot); }

export function persistPdfState(snapshot: SqliteSnapshot, manageTransaction = true) {
  const document = db().prepare("INSERT INTO pdf_documents(id,fsid,source_label,kind,text_mode,payload) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET fsid=excluded.fsid,source_label=excluded.source_label,kind=excluded.kind,text_mode=excluded.text_mode,payload=excluded.payload");
  const page = db().prepare("INSERT OR IGNORE INTO pdf_pages(document_id,page,text_hash,text) VALUES(?,?,?,?)");
  const deletePages = db().prepare("DELETE FROM pdf_pages WHERE document_id=?");
  const evidence = db().prepare("INSERT INTO evidence_items(id,source_label,company_id,report_year,action_class,status,payload) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_label=excluded.source_label,company_id=excluded.company_id,report_year=excluded.report_year,action_class=excluded.action_class,status=excluded.status,payload=excluded.payload");
  const aspect = db().prepare("INSERT INTO environmental_aspects(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload");
  const queue = db().prepare("INSERT OR IGNORE INTO pdf_queue(fsid,filename,remote_path,size,md5,kind,status,queued_at,completed_at,updated_at,page_count,text_page_count,text_mode) VALUES(?,?,?,?,?,?,'completed',?,?,?,?,?,?)");
  const incomingDocuments = snapshot.pdfDocuments.filter((item) => (item.pages?.length ?? 0) > 0);
  const incomingSources = incomingDocuments.map((item) => String(item.filename));
  const deleteEvidence = db().prepare("DELETE FROM evidence_items WHERE source_label=?");
  if (manageTransaction) db().exec("BEGIN IMMEDIATE");
  try {
    incomingSources.forEach((sourceLabel) => deleteEvidence.run(sourceLabel));
    for (const item of incomingDocuments) {
      const { pages = [], ...metadata } = item;
      const documentId = String(item.id);
      document.run(documentId, String(item.fsid), String(item.filename), String(item.kind), String(item.textMode), JSON.stringify(metadata));
      queue.run(String(item.fsid), String(item.filename), `/remote/${item.filename}`, Number(item.size), item.md5 ? String(item.md5) : null, String(item.kind), String(item.ingestedAt ?? new Date().toISOString()), String(item.ingestedAt ?? new Date().toISOString()), String(item.ingestedAt ?? new Date().toISOString()), Number(item.pageCount ?? 0), Number(item.textPageCount ?? 0), String(item.textMode));
      deletePages.run(documentId);
      for (const itemPage of pages) page.run(documentId, Number(itemPage.page), String(itemPage.textHash), String(itemPage.text));
    }
    snapshot.documentEvidence.forEach((item) => {
      const columns = evidenceColumnValues(item);
      evidence.run(String(item.id), String(item.sourceLabel), columns.companyId, columns.reportYear, columns.actionClass, columns.status, JSON.stringify(item));
    });
    snapshot.environmentalAspects.forEach((item) => aspect.run(String(item.id), JSON.stringify(item)));
    db().prepare("INSERT INTO metadata(key,value) VALUES('last_synced_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(snapshot.lastSyncedAt ?? "");
    if (manageTransaction) db().exec("COMMIT");
  } catch (error) {
    if (manageTransaction) db().exec("ROLLBACK");
    throw error;
  }
}

export function pdfDerivedSummary() {
  return {
    documentEvidenceCount: Number((db().prepare("SELECT COUNT(*) AS count FROM evidence_items").get() as { count: number }).count),
    environmentalAspectCount: Number((db().prepare("SELECT COUNT(*) AS count FROM environmental_aspects").get() as { count: number }).count),
  };
}

/** Lightweight table counts used as a cache-revision signal for live analysis. */
export function runtimeDataCounts() {
  const count = (table: string) => Number((db().prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count);
  return {
    sourceFiles: count("source_files"),
    financialRecords: count("financial_records"),
    companyScores: count("company_year_scores"),
    companyIndustries: count("company_industries"),
    esgRatings: count("esg_ratings"),
    violationEvents: count("violation_events"),
    evidenceItems: count("evidence_items"),
    environmentalAspects: count("environmental_aspects"),
    pdfDocuments: count("pdf_documents"),
    gsiScores: count("gsi_scores"),
    reviews: count("reviews"),
    gsiRevision: (db().prepare("SELECT value FROM metadata WHERE key='gsi_data_version'").get() as { value?: string } | undefined)?.value ?? "none",
    evidenceRevision: (db().prepare("SELECT value FROM metadata WHERE key='evidence_rebuild_revision'").get() as { value?: string } | undefined)?.value
      ?? (db().prepare("SELECT value FROM metadata WHERE key='evidence_linkage_keys_v2'").get() as { value?: string } | undefined)?.value
      ?? "none",
    lastSyncedAt: (db().prepare("SELECT value FROM metadata WHERE key='last_synced_at'").get() as { value?: string } | undefined)?.value ?? "none",
  };
}

export function runtimeDataRevision() {
  const value = (key: string) => (db().prepare("SELECT value FROM metadata WHERE key=?").get(key) as { value?: string } | undefined)?.value ?? "none";
  return [value("last_synced_at"), value("gsi_data_version"), value("evidence_rebuild_revision"), value("evidence_linkage_keys_v2")].join(":");
}

/** Release transient SQLite page and statement memory after a large read-only projection. */
export function releaseSqliteMemory() {
  db().exec("PRAGMA shrink_memory;");
}

export function readDashboardPersistentCache<T>(cacheKey: string, revision: string): T | null {
  const row = db().prepare("SELECT payload FROM dashboard_cache WHERE cache_key=? AND revision=?").get(cacheKey, revision) as { payload?: string } | undefined;
  if (!row?.payload) return null;
  try { return JSON.parse(row.payload) as T; } catch { return null; }
}

export function writeDashboardPersistentCache(cacheKey: string, revision: string, value: unknown) {
  db().prepare(`INSERT INTO dashboard_cache(cache_key,revision,payload,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(cache_key) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at`)
    .run(cacheKey, revision, JSON.stringify(value), new Date().toISOString());
  db().prepare("DELETE FROM dashboard_cache WHERE cache_key NOT IN (SELECT cache_key FROM dashboard_cache ORDER BY updated_at DESC LIMIT 48)").run();
}

export function listGsiScoreRecords(companyIds: string[] = [], maxYear?: number): GsiScoreRecord[] {
  if (!companyIds.length) return payloadRows("gsi_scores") as unknown as GsiScoreRecord[];
  return payloadRowsForCompanyIds("gsi_scores", companyIds, maxYear == null ? "" : "AND report_year<=?", maxYear == null ? [] : [maxYear]) as unknown as GsiScoreRecord[];
}

export function persistedFailedPdfIdentities(): Array<{ companyId: string; reportYear: number }> {
  return db().prepare("SELECT filename FROM pdf_queue WHERE status='failed' AND failure_category IN ('pdf_parse_failed','pdf_encrypted','pdf_invalid')").all().flatMap((row) => {
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

export function persistedEvidenceSummaries(companyIds: string[] = [], reportYear?: number): PersistedEvidenceSummary[] {
  if (companyIds.length > 400) {
    return companyIds.flatMap((_, offset) => offset % 400 === 0 ? persistedEvidenceSummaries(companyIds.slice(offset, offset + 400), reportYear) : []);
  }
  const scope = companyIds.length ? `AND company_id IN (${companyIds.map(() => "?").join(",")})` : "";
  const yearScope = reportYear == null ? "" : "AND report_year=?";
  return db().prepare(`
    SELECT company_id, report_year,
           COUNT(*) AS total,
           SUM(CASE WHEN action_class='implemented' THEN 1 ELSE 0 END) AS implemented,
           SUM(CASE WHEN action_class='planning' THEN 1 ELSE 0 END) AS planning,
           SUM(CASE WHEN action_class='indeterminate' THEN 1 ELSE 0 END) AS indeterminate,
           SUM(CASE WHEN status='insufficient' THEN 1 ELSE 0 END) AS insufficient,
           SUM(CASE WHEN action_class='planning' AND status='insufficient' THEN 1 ELSE 0 END) AS unverified_planning
     FROM evidence_items
     WHERE company_id IS NOT NULL
       AND report_year IS NOT NULL
       AND action_class IN ('implemented','planning','indeterminate')
       ${scope}
       ${yearScope}
     GROUP BY company_id, report_year
  `).all(...companyIds, ...(reportYear == null ? [] : [reportYear])).map((row) => ({
    companyId: String(row.company_id), reportYear: Number(row.report_year), total: Number(row.total),
    implemented: Number(row.implemented), planning: Number(row.planning), indeterminate: Number(row.indeterminate),
    insufficient: Number(row.insufficient), unverifiedPlanning: Number(row.unverified_planning),
  }));
}

export function persistedEvidenceItems(companyId: string, reportYear?: number): EvidenceItem[] {
  const rows = reportYear == null
    ? db().prepare("SELECT payload FROM evidence_items WHERE company_id=?").all(companyId)
    : db().prepare("SELECT payload FROM evidence_items WHERE company_id=? AND report_year=?").all(companyId, reportYear);
  return rows.map((row) => {
    const item = parse<EvidenceItem>(row.payload);
    return { ...item, excerpt: item.excerpt ?? "" };
  });
}

export function allPersistedEvidenceItems(): EvidenceItem[] {
  return db().prepare("SELECT payload FROM evidence_items").all().map((row) => {
    const item = parse<EvidenceItem>(row.payload);
    return { ...item, excerpt: item.excerpt ?? "" };
  });
}

/**
 * Dashboard calculations only need a bounded set of evidence IDs and excerpts
 * per company-year. The company_id/report_year/id columns are materialized so
 * this index scan no longer JSON-parses every evidence row.
 */
export function persistedEvidenceSamplesByKey(limitPerKey = 12, companyIds: string[] = [], reportYear?: number): Map<string, EvidenceItem[]> {
  if (companyIds.length > 400) {
    const combined = new Map<string, EvidenceItem[]>();
    for (let offset = 0; offset < companyIds.length; offset += 400) {
      for (const [key, items] of persistedEvidenceSamplesByKey(limitPerKey, companyIds.slice(offset, offset + 400), reportYear)) combined.set(key, items);
    }
    return combined;
  }
  const selectedIds: string[] = [];
  const keysById = new Map<string, string>();
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limitPerKey)));
  const selectedCompanies = companyIds;
  const companyScope = selectedCompanies.length ? `AND company_id IN (${selectedCompanies.map(() => "?").join(",")})` : "";
  const yearScope = reportYear == null ? "" : "AND report_year=?";
  const indexRows = db().prepare(`
    SELECT id, company_id, report_year FROM (
      SELECT id, company_id, report_year,
             ROW_NUMBER() OVER (PARTITION BY company_id, report_year ORDER BY id) AS rn
      FROM evidence_items
      WHERE company_id IS NOT NULL AND report_year IS NOT NULL
        ${companyScope}
        ${yearScope}
    ) WHERE rn <= ?
  `).all(...selectedCompanies, ...(reportYear == null ? [] : [reportYear]), safeLimit) as Array<Record<string, unknown>>;
  for (const row of indexRows) {
    const id = String(row.id);
    const key = `${String(row.company_id)}:${Number(row.report_year)}`;
    selectedIds.push(id);
    keysById.set(id, key);
  }
  const samples = new Map<string, EvidenceItem[]>();
  for (let offset = 0; offset < selectedIds.length; offset += 500) {
    const ids = selectedIds.slice(offset, offset + 500);
    const placeholders = ids.map(() => "?").join(",");
    const rows = db().prepare(`SELECT payload FROM evidence_items WHERE id IN (${placeholders})`).all(...ids) as Array<{ payload: string }>;
    for (const row of rows) {
      const item = parse<EvidenceItem>(row.payload);
      const key = keysById.get(item.id);
      if (!key) continue;
      const current = samples.get(key) ?? [];
      current.push({ ...item, excerpt: item.excerpt ?? "" });
      samples.set(key, current);
    }
  }
  return samples;
}

export function persistedEnvironmentalAspects(companyId?: string, reportYear?: number): EnvironmentalAspectScore[] {
  if (companyId && reportYear != null) {
    return db().prepare("SELECT payload FROM environmental_aspects WHERE json_extract(payload,'$.companyId')=? AND CAST(json_extract(payload,'$.reportYear') AS INTEGER)=?").all(companyId, reportYear).map((row) => parse<EnvironmentalAspectScore>(row.payload));
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
  for (const row of db().prepare("SELECT id, status FROM evidence_items").all()) {
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

function evidenceCandidateScope(scope: EvidenceReindexScope, extractorVersion: string) {
  if (scope === "failed_only") {
    return { sql: "EXISTS (SELECT 1 FROM pdf_evidence_jobs pej WHERE pej.document_id=pd.id AND pej.status IN ('identity_unresolved','text_unavailable','extraction_failed','score_unmatched'))", params: [] as SQLInputValue[] };
  }
  if (scope === "version_outdated") {
    return {
      sql: "(EXISTS (SELECT 1 FROM pdf_evidence_jobs pej WHERE pej.document_id=pd.id AND pej.extractor_version<>?) OR (NOT EXISTS (SELECT 1 FROM pdf_evidence_jobs current_job WHERE current_job.document_id=pd.id) AND EXISTS (SELECT 1 FROM evidence_items ei WHERE ei.source_label=pd.source_label)))",
      params: [extractorVersion] as SQLInputValue[],
    };
  }
  return {
    sql: "NOT EXISTS (SELECT 1 FROM evidence_items ei WHERE ei.source_label=pd.source_label)",
    params: [] as SQLInputValue[],
  };
}

function evidenceCandidateBase(scope: EvidenceReindexScope, extractorVersion: string, kind: PdfDocumentKind) {
  const scoped = evidenceCandidateScope(scope, extractorVersion);
  return {
    sql: `
      FROM pdf_documents pd
      JOIN pdf_queue pq ON pq.fsid=pd.fsid AND pq.status='completed'
     WHERE pd.kind=?
       AND EXISTS (SELECT 1 FROM pdf_pages pp WHERE pp.document_id=pd.id AND LENGTH(TRIM(pp.text))>0)
       AND NOT EXISTS (SELECT 1 FROM pdf_evidence_jobs active WHERE active.document_id=pd.id AND active.status IN ('queued','resolving_identity','extracting','aggregating','linking'))
       AND ${scoped.sql}
    `,
    params: [kind, ...scoped.params] as SQLInputValue[],
  };
}

export function countDocumentsForEvidenceRebuild(options: { scope?: EvidenceReindexScope; extractorVersion: string; kind?: PdfDocumentKind }) {
  const base = evidenceCandidateBase(options.scope ?? "missing_only", options.extractorVersion, options.kind ?? "esg_report");
  return Number((db().prepare(`SELECT COUNT(*) AS count ${base.sql}`).get(...base.params) as { count: number }).count);
}

export function listDocumentsForEvidenceRebuild(options: {
  cursor?: string;
  limit?: number;
  onlyMissingEvidence?: boolean;
  scope?: EvidenceReindexScope;
  extractorVersion: string;
  kind?: PdfDocumentKind;
}): EvidenceRebuildDocument[] {
  const scope = options.onlyMissingEvidence ? "missing_only" : options.scope ?? "missing_only";
  const base = evidenceCandidateBase(scope, options.extractorVersion, options.kind ?? "esg_report");
  const limit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 20)));
  const cursorSql = options.cursor ? " AND pd.id>?" : "";
  const rows = db().prepare(`SELECT pd.id,pd.fsid,pd.kind,pd.text_mode,pd.payload ${base.sql}${cursorSql} ORDER BY pd.id LIMIT ?`)
    .all(...base.params, ...(options.cursor ? [options.cursor] : []), limit);
  const pages = db().prepare("SELECT page,text_hash,text FROM pdf_pages WHERE document_id=? AND LENGTH(TRIM(text))>0 ORDER BY page");
  return rows.map((row) => {
    const metadata = parse<PdfDocumentRecord>(row.payload);
    return {
      documentId: String(row.id),
      fsid: String(row.fsid),
      filename: metadata.filename,
      kind: String(row.kind) as PdfDocumentKind,
      textMode: String(row.text_mode) as EvidenceRebuildDocument["textMode"],
      metadata,
      pages: pages.all(String(row.id)).map((page) => ({ page: Number(page.page), textHash: String(page.text_hash), text: String(page.text) })),
    };
  });
}

export function getDocumentForEvidenceRebuild(documentId: string): EvidenceRebuildDocument | null {
  const row = db().prepare("SELECT id,fsid,kind,text_mode,payload FROM pdf_documents WHERE id=?").get(documentId);
  if (!row) return null;
  const metadata = parse<PdfDocumentRecord>(row.payload);
  const pages = db().prepare("SELECT page,text_hash,text FROM pdf_pages WHERE document_id=? AND LENGTH(TRIM(text))>0 ORDER BY page").all(documentId)
    .map((page) => ({ page: Number(page.page), textHash: String(page.text_hash), text: String(page.text) }));
  return { documentId, fsid: String(row.fsid), filename: metadata.filename, kind: String(row.kind) as PdfDocumentKind, textMode: String(row.text_mode) as EvidenceRebuildDocument["textMode"], metadata, pages };
}

export function listPdfEvidenceExceptions(limit = 50) {
  return db().prepare(`
    SELECT pej.document_id,pej.status,pej.error_code,pej.error_detail,pej.identity_sources,pej.alternative_candidates,pej.updated_at,pd.source_label,pd.payload
      FROM pdf_evidence_jobs pej
      JOIN pdf_documents pd ON pd.id=pej.document_id
     WHERE pej.status IN ('identity_unresolved','text_unavailable','extraction_failed','score_unmatched')
     ORDER BY pej.updated_at DESC
     LIMIT ?
  `).all(Math.max(1, Math.min(100, Math.floor(limit)))).map((row) => ({
    documentId: String(row.document_id),
    filename: String(row.source_label),
    status: String(row.status),
    errorCode: row.error_code ? String(row.error_code) : undefined,
    errorDetail: row.error_detail ? String(row.error_detail) : undefined,
    identitySources: row.identity_sources ? parse<string[]>(row.identity_sources) : [],
    alternativeCandidates: row.alternative_candidates ? parse<Array<{ companyId: string; stockCode: string; companyName: string }>>(row.alternative_candidates) : [],
    metadata: parse<PdfDocumentRecord>(row.payload),
    updatedAt: String(row.updated_at),
  }));
}

export function evidenceReindexFunnel(): EvidenceReindexFunnel {
  const scalar = (sql: string) => Number((db().prepare(sql).get() as { count: number }).count);
  const completedDocuments = scalar("SELECT COUNT(*) AS count FROM pdf_queue WHERE status='completed' AND kind='esg_report'");
  const documentsWithTextPages = scalar(`SELECT COUNT(DISTINCT pd.id) AS count FROM pdf_documents pd JOIN pdf_queue pq ON pq.fsid=pd.fsid AND pq.status='completed' WHERE pd.kind='esg_report' AND EXISTS (SELECT 1 FROM pdf_pages pp WHERE pp.document_id=pd.id AND LENGTH(TRIM(pp.text))>0)`);
  const identityResolvedDocuments = scalar(`SELECT COUNT(DISTINCT pd.id) AS count FROM pdf_documents pd JOIN pdf_queue pq ON pq.fsid=pd.fsid AND pq.status='completed' WHERE pd.kind='esg_report' AND EXISTS (SELECT 1 FROM pdf_pages pp WHERE pp.document_id=pd.id AND LENGTH(TRIM(pp.text))>0) AND ((json_extract(pd.payload,'$.stockCode') IS NOT NULL AND CAST(json_extract(pd.payload,'$.reportYear') AS INTEGER) IS NOT NULL) OR EXISTS (SELECT 1 FROM pdf_evidence_jobs pej WHERE pej.document_id=pd.id AND pej.identity_status IN ('resolved','manual_resolved')))`);
  const evidenceExtractedDocuments = scalar(`SELECT COUNT(DISTINCT pd.id) AS count FROM pdf_documents pd WHERE pd.kind='esg_report' AND EXISTS (SELECT 1 FROM evidence_items ei WHERE ei.source_label=pd.source_label)`);
  const linkedCompanyYearDocuments = scalar(`SELECT COUNT(DISTINCT pd.id) AS count FROM pdf_documents pd JOIN evidence_items ei ON ei.source_label=pd.source_label JOIN company_year_scores cys ON cys.company_id=ei.company_id AND cys.report_year=ei.report_year WHERE pd.kind='esg_report'`);
  const extractionFailedDocuments = scalar("SELECT COUNT(*) AS count FROM pdf_evidence_jobs WHERE status='extraction_failed'");
  const scoreUnmatchedDocuments = scalar("SELECT COUNT(*) AS count FROM pdf_evidence_jobs WHERE status='score_unmatched'");
  return {
    completedDocuments,
    documentsWithTextPages,
    identityResolvedDocuments,
    evidenceExtractedDocuments,
    linkedCompanyYearDocuments,
    identityUnresolvedDocuments: Math.max(0, documentsWithTextPages - identityResolvedDocuments),
    extractionFailedDocuments,
    scoreUnmatchedDocuments,
  };
}

export function persistedCompanyScoreRecords(): CompanyScoreRecord[] {
  return payloadRows("company_year_scores") as unknown as CompanyScoreRecord[];
}

export function persistedCompanyAliases(): Array<{ companyId: string; alias: string }> {
  const rows = db().prepare(`
    SELECT company_id,json_extract(payload,'$.companyName') AS alias FROM company_year_scores
    UNION
    SELECT company_id,json_extract(payload,'$.companyName') AS alias FROM financial_records
  `).all();
  return rows.flatMap((row) => row.company_id && row.alias ? [{ companyId: String(row.company_id), alias: String(row.alias) }] : []);
}

export function hasCompanyYearScore(companyId: string, reportYear: number) {
  return Boolean(db().prepare("SELECT 1 FROM company_year_scores WHERE company_id=? AND report_year=? LIMIT 1").get(companyId, reportYear));
}

function rowToEvidenceReindexRun(row: Record<string, unknown>): EvidenceReindexRun {
  return {
    jobId: String(row.job_id),
    status: String(row.status) as EvidenceReindexRun["status"],
    scope: String(row.scope) as EvidenceReindexScope,
    kind: String(row.kind) as PdfDocumentKind,
    extractorVersion: String(row.extractor_version),
    totalCandidates: Number(row.total_candidates),
    processed: Number(row.processed),
    succeeded: Number(row.succeeded),
    failed: Number(row.failed),
    cursor: row.cursor ? String(row.cursor) : undefined,
    startedAt: row.started_at ? String(row.started_at) : undefined,
    completedAt: row.completed_at ? String(row.completed_at) : undefined,
    updatedAt: String(row.updated_at),
    error: row.error ? parse<EvidenceReindexRun["error"]>(row.error) : undefined,
  };
}

export function createEvidenceReindexRun(input: { jobId: string; scope: EvidenceReindexScope; kind: PdfDocumentKind; extractorVersion: string; totalCandidates: number }): EvidenceReindexRun {
  const now = new Date().toISOString();
  db().prepare("INSERT INTO evidence_reindex_runs(job_id,status,scope,kind,extractor_version,total_candidates,updated_at) VALUES(?,'queued',?,?,?,?,?)")
    .run(input.jobId, input.scope, input.kind, input.extractorVersion, input.totalCandidates, now);
  return getEvidenceReindexRun(input.jobId)!;
}

export function getEvidenceReindexRun(jobId: string): EvidenceReindexRun | null {
  const row = db().prepare("SELECT * FROM evidence_reindex_runs WHERE job_id=?").get(jobId) as Record<string, unknown> | undefined;
  return row ? rowToEvidenceReindexRun(row) : null;
}

export function findActiveEvidenceReindexRun(input: { scope: EvidenceReindexScope; kind: PdfDocumentKind; extractorVersion: string }): EvidenceReindexRun | null {
  const row = db().prepare("SELECT * FROM evidence_reindex_runs WHERE status IN ('queued','running') AND scope=? AND kind=? AND extractor_version=? ORDER BY updated_at DESC LIMIT 1")
    .get(input.scope, input.kind, input.extractorVersion) as Record<string, unknown> | undefined;
  return row ? rowToEvidenceReindexRun(row) : null;
}

export function listActiveEvidenceReindexRuns(): EvidenceReindexRun[] {
  const rows = db().prepare("SELECT * FROM evidence_reindex_runs WHERE status IN ('queued','running') ORDER BY updated_at ASC").all() as Record<string, unknown>[];
  return rows.map(rowToEvidenceReindexRun);
}

export function claimEvidenceReindexRun(jobId: string, startedAt: string, staleBefore: string) {
  const result = db().prepare("UPDATE evidence_reindex_runs SET status='running',started_at=COALESCE(started_at,?),updated_at=? WHERE job_id=? AND (status='queued' OR (status='running' AND updated_at<?))")
    .run(startedAt, startedAt, jobId, staleBefore);
  return result.changes === 1;
}

export function updateEvidenceReindexRun(jobId: string, patch: Partial<Omit<EvidenceReindexRun, "jobId" | "scope" | "kind" | "extractorVersion" | "totalCandidates">>) {
  const current = getEvidenceReindexRun(jobId);
  if (!current) throw new Error(`Evidence reindex run ${jobId} was not found.`);
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  db().prepare("UPDATE evidence_reindex_runs SET status=?,processed=?,succeeded=?,failed=?,cursor=?,started_at=?,completed_at=?,updated_at=?,error=? WHERE job_id=?")
    .run(next.status, next.processed, next.succeeded, next.failed, next.cursor ?? null, next.startedAt ?? null, next.completedAt ?? null, next.updatedAt, next.error ? JSON.stringify(next.error) : null, jobId);
  return getEvidenceReindexRun(jobId)!;
}

export function upsertPdfEvidenceJob(input: {
  documentId: string;
  runId?: string;
  status: PdfEvidenceJobStatus;
  identityStatus: string;
  linkageStatus: string;
  extractorVersion: string;
  incrementAttempts?: boolean;
  evidenceCount?: number;
  errorCode?: string;
  errorDetail?: string;
  identity?: EvidenceIdentityResolution;
  startedAt?: string;
  completedAt?: string;
}) {
  const now = new Date().toISOString();
  const identity = input.identity;
  db().prepare(`
    INSERT INTO pdf_evidence_jobs(document_id,run_id,status,identity_status,linkage_status,extractor_version,attempts,evidence_count,error_code,error_detail,resolved_company_id,resolved_stock_code,report_year,identity_confidence,year_confidence,identity_sources,alternative_candidates,started_at,completed_at,updated_at)
    VALUES(?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(document_id) DO UPDATE SET
      run_id=excluded.run_id,status=excluded.status,identity_status=excluded.identity_status,linkage_status=excluded.linkage_status,
      extractor_version=excluded.extractor_version,attempts=pdf_evidence_jobs.attempts+excluded.attempts,evidence_count=excluded.evidence_count,
      error_code=excluded.error_code,error_detail=excluded.error_detail,resolved_company_id=excluded.resolved_company_id,resolved_stock_code=excluded.resolved_stock_code,
      report_year=excluded.report_year,identity_confidence=excluded.identity_confidence,year_confidence=excluded.year_confidence,
      identity_sources=excluded.identity_sources,alternative_candidates=excluded.alternative_candidates,started_at=COALESCE(excluded.started_at,pdf_evidence_jobs.started_at),completed_at=excluded.completed_at,updated_at=excluded.updated_at
  `).run(
    input.documentId, input.runId ?? null, input.status, input.identityStatus, input.linkageStatus, input.extractorVersion,
    input.incrementAttempts ? 1 : 0, input.evidenceCount ?? 0, input.errorCode ?? null, input.errorDetail ?? null,
    identity?.resolvedCompanyId ?? null, identity?.resolvedStockCode ?? null, identity?.reportYear ?? null,
    identity?.identityConfidence ?? null, identity?.yearConfidence ?? null,
    identity ? JSON.stringify(identity.identitySources) : null, identity ? JSON.stringify(identity.alternativeCandidates) : null,
    input.startedAt ?? null, input.completedAt ?? null, now,
  );
}

export function replaceEvidenceForDocument(input: {
  document: EvidenceRebuildDocument;
  identity: EvidenceIdentityResolution;
  extractorVersion: string;
  evidence: EvidenceItem[];
  aspects: EnvironmentalAspectScore[];
}) {
  const { document, identity, evidence, aspects } = input;
  if (identity.status !== "resolved" || !identity.resolvedCompanyId || !identity.resolvedStockCode || !identity.reportYear) throw new Error("Cannot persist evidence without a resolved company and report year.");
  db().exec("BEGIN IMMEDIATE");
  try {
    const uniqueSource = Number((db().prepare("SELECT COUNT(*) AS count FROM pdf_documents WHERE source_label=?").get(document.filename) as { count: number }).count) === 1;
    const oldRows = uniqueSource
      ? db().prepare("SELECT id,payload FROM evidence_items WHERE source_label=?").all(document.filename)
      : db().prepare("SELECT id,payload FROM evidence_items WHERE json_extract(payload,'$.documentId')=?").all(document.documentId);
    const oldAspectIds = new Set(oldRows.flatMap((row) => {
      const aspectId = parse<EvidenceItem>(row.payload).aspectId;
      return aspectId ? [aspectId] : [];
    }));
    const deleteEvidence = db().prepare("DELETE FROM evidence_items WHERE id=?");
    oldRows.forEach((row) => deleteEvidence.run(String(row.id)));
    const deleteAspect = db().prepare("DELETE FROM environmental_aspects WHERE id=?");
    for (const row of db().prepare("SELECT id FROM environmental_aspects WHERE json_extract(payload,'$.documentId')=?").all(document.documentId)) deleteAspect.run(String(row.id));
    oldAspectIds.forEach((id) => deleteAspect.run(id));
    const insertEvidence = db().prepare("INSERT INTO evidence_items(id,source_label,company_id,report_year,action_class,status,payload) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_label=excluded.source_label,company_id=excluded.company_id,report_year=excluded.report_year,action_class=excluded.action_class,status=excluded.status,payload=excluded.payload");
    evidence.forEach((item) => {
      const columns = evidenceColumnValues(item);
      insertEvidence.run(item.id, item.sourceLabel, columns.companyId, columns.reportYear, columns.actionClass, columns.status, JSON.stringify(item));
    });
    const insertAspect = db().prepare("INSERT INTO environmental_aspects(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload");
    aspects.forEach((item) => insertAspect.run(item.id, JSON.stringify(item)));

    const metadata = { ...document.metadata, stockCode: identity.resolvedStockCode, companyName: identity.alternativeCandidates.find((item) => item.companyId === identity.resolvedCompanyId)?.companyName ?? document.metadata.companyName, reportYear: identity.reportYear, publicationDate: identity.publicationDate ?? document.metadata.publicationDate, parseStatus: "ready" as const, qualityFlags: document.metadata.qualityFlags.filter((flag) => !["COMPANY_CODE_UNRESOLVED", "REPORT_YEAR_UNRESOLVED"].includes(flag)) };
    db().prepare("UPDATE pdf_documents SET payload=? WHERE id=?").run(JSON.stringify(metadata), document.documentId);
    const sourceRow = db().prepare("SELECT payload FROM source_files WHERE id=?").get(document.documentId);
    if (sourceRow) {
      const source = parse<JsonRecord>(sourceRow.payload);
      source.parseStatus = "ready";
      source.qualityFlags = Array.isArray(source.qualityFlags) ? source.qualityFlags.filter((flag) => !["COMPANY_CODE_UNRESOLVED", "REPORT_YEAR_UNRESOLVED"].includes(String(flag))) : [];
      db().prepare("UPDATE source_files SET payload=? WHERE id=?").run(JSON.stringify(source), document.documentId);
    }
    db().exec("COMMIT");
  } catch (error) {
    db().exec("ROLLBACK");
    throw error;
  }
}

export function recordEvidenceBackfillMigration(run: EvidenceReindexRun) {
  const payload = JSON.stringify({ ...run, completedAt: run.completedAt ?? new Date().toISOString() });
  const statement = db().prepare("INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  statement.run("evidence_rebuild_revision", payload);
  statement.run("evidence_extraction_backfill_v3", payload);
  statement.run("evidence_linkage_keys_v3", payload);
  statement.run("aggregate_company_year_evidence_v3", payload);
}

export function touchEvidenceRevision(input: { documentId: string; extractorVersion: string; evidenceCount: number }) {
  db().prepare("INSERT INTO metadata(key,value) VALUES('evidence_rebuild_revision',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(JSON.stringify({ ...input, updatedAt: new Date().toISOString() }));
}

export function saveReviewRecord(review: ReviewRecord): ReviewRecord {
  const reviewedAt = review.reviewedAt ?? new Date().toISOString();
  const normalized: ReviewRecord = { ...review, reviewedAt };
  db().prepare(`
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
  return db().prepare(`SELECT payload FROM reviews${where} ORDER BY reviewed_at DESC`).all(...params).map((row) => parse<ReviewRecord>(row.payload));
}

export function saveReviewQueueAction(action: ReviewQueueAction): ReviewQueueAction {
  db().prepare(`
    INSERT INTO review_queue_actions(task_id,id,company_id,action,acted_at,payload)
    VALUES(?,?,?,?,?,?)
    ON CONFLICT(task_id) DO UPDATE SET
      id=excluded.id,
      company_id=excluded.company_id,
      action=excluded.action,
      acted_at=excluded.acted_at,
      payload=excluded.payload
  `).run(action.taskId, action.id, action.companyId, action.action, action.actedAt, JSON.stringify(action));
  return action;
}

export function listReviewQueueActions(): ReviewQueueAction[] {
  return db().prepare("SELECT payload FROM review_queue_actions ORDER BY acted_at DESC").all().map((row) => parse<ReviewQueueAction>(row.payload));
}

export interface AnalysisJobFileInput {
  companyId: string;
  reportYear: number;
  fileName: string;
  fileSize: number;
  mimeType?: string;
  fileHash?: string;
  documentId?: string;
  storagePath?: string;
}

export interface AnalysisJobContext extends Required<AnalysisJobFileInput> {
  attempts: number;
  cancelRequested: boolean;
}

function analysisJobFromRow(row: JsonRecord): AnalysisJob {
  if (row.payload) return parse<AnalysisJob>(row.payload);
  return {
    jobId: String(row.job_id), reportId: String(row.report_id), status: String(row.status) as AnalysisJob["status"],
    phase: String(row.phase) as AnalysisJob["phase"], progress: Number(row.progress),
    resultCompanyId: row.result_company_id ? String(row.result_company_id) : undefined,
    error: row.error ? parse<AnalysisJob["error"]>(row.error) : undefined,
    attempts: Number(row.attempts ?? 1), createdAt: String(row.created_at),
  };
}

export function createAnalysisJobRecord(input: AnalysisJobFileInput): AnalysisJob {
  const now = new Date().toISOString();
  const jobId = crypto.randomUUID();
  const documentId = input.documentId ?? `report-${Date.now()}`;
  const job: AnalysisJob = {
    jobId, reportId: documentId, status: "queued", phase: "collect", stage: "uploaded", progress: 0,
    resultCompanyId: input.companyId,
    document: input.fileHash ? { documentId, fileName: input.fileName, fileSize: input.fileSize, fileHash: input.fileHash } : undefined,
    attempts: 1, createdAt: now,
  };
  db().prepare(`
    INSERT INTO analysis_jobs(job_id,report_id,company_id,report_year,file_name,file_size,status,phase,progress,result_company_id,error,created_at,updated_at,document_id,file_hash,storage_path,mime_type,attempts,cancel_requested,payload)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(jobId, job.reportId, input.companyId, input.reportYear, input.fileName, input.fileSize, job.status, job.phase, job.progress, job.resultCompanyId ?? null, null, now, now, documentId, input.fileHash ?? null, input.storagePath ?? null, input.mimeType ?? null, 1, 0, JSON.stringify(job));
  return job;
}

export function getAnalysisJobRecord(jobId: string): AnalysisJob | null {
  const row = db().prepare("SELECT * FROM analysis_jobs WHERE job_id=?").get(jobId);
  return row ? analysisJobFromRow(row as JsonRecord) : null;
}

export function getAnalysisJobContext(jobId: string): AnalysisJobContext | null {
  const row = db().prepare("SELECT company_id,report_year,file_name,file_size,mime_type,file_hash,document_id,storage_path,attempts,cancel_requested FROM analysis_jobs WHERE job_id=?").get(jobId);
  if (!row || !row.storage_path || !row.file_hash || !row.document_id) return null;
  return {
    companyId: String(row.company_id), reportYear: Number(row.report_year), fileName: String(row.file_name), fileSize: Number(row.file_size),
    mimeType: String(row.mime_type ?? "application/pdf"), fileHash: String(row.file_hash), documentId: String(row.document_id),
    storagePath: String(row.storage_path), attempts: Number(row.attempts ?? 1), cancelRequested: Boolean(row.cancel_requested),
  };
}

export function updateAnalysisJobRecord(jobId: string, patch: Partial<AnalysisJob>): AnalysisJob | null {
  const current = getAnalysisJobRecord(jobId);
  if (!current) return null;
  const next: AnalysisJob = { ...current, ...patch };
  const now = new Date().toISOString();
  db().prepare("UPDATE analysis_jobs SET status=?,phase=?,progress=?,result_company_id=?,error=?,started_at=?,completed_at=?,payload=?,updated_at=? WHERE job_id=?")
    .run(next.status, next.phase, next.progress, next.resultCompanyId ?? null, next.error ? JSON.stringify(next.error) : null, next.startedAt ?? null, next.completedAt ?? null, JSON.stringify(next), now, jobId);
  return next;
}

export function requestAnalysisJobCancellation(jobId: string): AnalysisJob | null {
  const job = getAnalysisJobRecord(jobId);
  if (!job || job.status === "completed" || job.status === "failed" || job.status === "cancelled") return job;
  db().prepare("UPDATE analysis_jobs SET cancel_requested=1,updated_at=? WHERE job_id=?").run(new Date().toISOString(), jobId);
  return updateAnalysisJobRecord(jobId, { status: "cancelled", stage: "cancelled", completedAt: new Date().toISOString(), error: undefined });
}

export function isAnalysisJobCancellationRequested(jobId: string) {
  const row = db().prepare("SELECT cancel_requested FROM analysis_jobs WHERE job_id=?").get(jobId);
  return Boolean(row?.cancel_requested);
}

export function retryAnalysisJobRecord(jobId: string): AnalysisJob | null {
  const current = getAnalysisJobRecord(jobId);
  const context = getAnalysisJobContext(jobId);
  if (!current || !context) return null;
  const attempts = context.attempts + 1;
  const next: AnalysisJob = { ...current, status: "queued", phase: "collect", stage: "uploaded", progress: 0, attempts, startedAt: undefined, completedAt: undefined, error: undefined };
  db().prepare("UPDATE analysis_jobs SET status=?,phase=?,progress=0,error=NULL,attempts=?,cancel_requested=0,started_at=NULL,completed_at=NULL,payload=?,updated_at=? WHERE job_id=?")
    .run(next.status, next.phase, attempts, JSON.stringify(next), new Date().toISOString(), jobId);
  return next;
}

export function findCompletedAnalysisJob(fileHash: string, companyId: string, reportYear: number): AnalysisJob | null {
  const row = db().prepare("SELECT * FROM analysis_jobs WHERE file_hash=? AND company_id=? AND report_year=? AND status='completed' ORDER BY completed_at DESC LIMIT 1").get(fileHash, companyId, reportYear);
  return row ? analysisJobFromRow(row as JsonRecord) : null;
}

export function evidencePageText(companyId: string, evidenceId: string, page?: number): EvidencePageReference | null {
  const item = persistedEvidenceItems(companyId).find((entry) => entry.id === evidenceId);
  if (!item || !item.sourceLabel) return null;
  const document = item.documentId
    ? db().prepare("SELECT id,payload FROM pdf_documents WHERE id=?").get(item.documentId)
    : db().prepare("SELECT id,payload FROM pdf_documents WHERE source_label=? ORDER BY json_extract(payload,'$.ingestedAt') DESC LIMIT 1").get(item.sourceLabel);
  if (!document) return null;
  const metadata = parse<PdfDocumentRecord>(document.payload);
  const resolvedPage = page ?? item.page;
  if (resolvedPage == null || resolvedPage < 1 || resolvedPage > metadata.pageCount) return null;
  const textRow = db().prepare("SELECT text FROM pdf_pages WHERE document_id=? AND page=?").get(String(document.id), resolvedPage);
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
  db().exec("BEGIN IMMEDIATE");
  try {
    db().prepare("INSERT INTO ingest_sessions(session_id,task_type,status,started_at,updated_at) VALUES(?,'pdf',?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at").run(sessionId, complete ? "finalizing" : "running", now, now);
    const item = db().prepare("INSERT INTO ingest_session_items(session_id,item_key,payload) VALUES(?,?,?) ON CONFLICT(session_id,item_key) DO UPDATE SET payload=excluded.payload");
    const page = db().prepare("INSERT OR IGNORE INTO ingest_session_pages(session_id,item_key,page,text_hash,text) VALUES(?,?,?,?,?)");
    let accepted = 0;
    for (const input of documents) {
      const key = `${input.fsid}:${input.filename}`; const { pages, ...metadata } = input;
      item.run(sessionId, key, JSON.stringify(metadata));
      pages.forEach((entry) => { page.run(sessionId, key, entry.page, entry.textHash, entry.text); accepted += 1; });
    }
    db().prepare("UPDATE ingest_sessions SET accepted_count=accepted_count+?,updated_at=? WHERE session_id=?").run(accepted, now, sessionId);
    db().exec("COMMIT"); return accepted;
  } catch (error) { db().exec("ROLLBACK"); throw error; }
}

interface StagedExcelFile { fsid: string; filename: string; size: number; md5?: string; rows: JsonRecord[]; }
export function stageExcelBatch(sessionId: string, files: StagedExcelFile[], complete: boolean) {
  const now = new Date().toISOString(); db().exec("BEGIN IMMEDIATE");
  try {
    db().prepare("INSERT INTO ingest_sessions(session_id,task_type,status,started_at,updated_at) VALUES(?,'excel',?,?,?) ON CONFLICT(session_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at").run(sessionId, complete ? "finalizing" : "running", now, now);
    const item = db().prepare("INSERT INTO ingest_session_items(session_id,item_key,payload) VALUES(?,?,?) ON CONFLICT(session_id,item_key) DO UPDATE SET payload=excluded.payload");
    const rowInsert = db().prepare("INSERT INTO ingest_session_rows(session_id,item_key,row_index,payload) VALUES(?,?,?,?)");
    let accepted = 0;
    for (const file of files) {
      const key = `${file.fsid}:${file.filename}`; const { rows, ...metadata } = file; item.run(sessionId, key, JSON.stringify(metadata));
      const start = Number((db().prepare("SELECT COALESCE(MAX(row_index),-1)+1 AS next FROM ingest_session_rows WHERE session_id=? AND item_key=?").get(sessionId, key) as { next: number }).next);
      rows.forEach((entry, index) => { rowInsert.run(sessionId, key, start + index, JSON.stringify(entry)); accepted += 1; });
    }
    db().prepare("UPDATE ingest_sessions SET accepted_count=accepted_count+?,updated_at=? WHERE session_id=?").run(accepted, now, sessionId);
    db().exec("COMMIT"); return accepted;
  } catch (error) { db().exec("ROLLBACK"); throw error; }
}

export function readStagedExcelSession(sessionId: string): StagedExcelFile[] {
  return db().prepare("SELECT item_key,payload FROM ingest_session_items WHERE session_id=?").all(sessionId).map((row) => ({ ...parse<Omit<StagedExcelFile, "rows">>(row.payload), rows: db().prepare("SELECT payload FROM ingest_session_rows WHERE session_id=? AND item_key=? ORDER BY row_index").all(sessionId, row.item_key).map((item) => parse<JsonRecord>(item.payload)) }));
}

export function readStagedPdfSession(sessionId: string): NetdiskPdfDocumentInput[] {
  return db().prepare("SELECT item_key,payload FROM ingest_session_items WHERE session_id=?").all(sessionId).map((row) => {
    const metadata = parse<Omit<NetdiskPdfDocumentInput, "pages">>(row.payload);
    const pages = db().prepare("SELECT page,text_hash,text FROM ingest_session_pages WHERE session_id=? AND item_key=? ORDER BY page").all(sessionId, row.item_key).map((item) => ({ page: Number(item.page), textHash: String(item.text_hash), text: String(item.text) }));
    return { ...metadata, pages };
  });
}

export function finishSession(sessionId: string, status: string, error?: JsonRecord) {
  db().prepare("UPDATE ingest_sessions SET status=?,error=?,updated_at=? WHERE session_id=?").run(status, error ? JSON.stringify(error) : null, new Date().toISOString(), sessionId);
  if (["completed", "completed_with_warnings"].includes(status)) {
    db().prepare("DELETE FROM ingest_session_pages WHERE session_id=?").run(sessionId);
    db().prepare("DELETE FROM ingest_session_items WHERE session_id=?").run(sessionId);
    db().prepare("DELETE FROM ingest_session_rows WHERE session_id=?").run(sessionId);
  }
}

export function readSessionStatus(sessionId: string) {
  const row = db().prepare("SELECT session_id,task_type,status,accepted_count,started_at,updated_at,error FROM ingest_sessions WHERE session_id=?").get(sessionId);
  if (!row) return null;
  return { sessionId: String(row.session_id), taskType: String(row.task_type), status: String(row.status), acceptedCount: Number(row.accepted_count), startedAt: String(row.started_at), updatedAt: String(row.updated_at), error: row.error ? parse<JsonRecord>(row.error) : undefined };
}

export function pdfQueueSummary() {
  const rows = db().prepare("SELECT status,COUNT(*) AS count FROM pdf_queue GROUP BY status").all();
  const counts = Object.fromEntries(rows.map((row) => [String(row.status), Number(row.count)]));
  const current = db().prepare("SELECT fsid,filename,attempts,started_at FROM pdf_queue WHERE status='running' ORDER BY started_at LIMIT 1").get();
  const failureRows = db().prepare("SELECT COALESCE(failure_category,'unclassified') AS category,COUNT(*) AS count FROM pdf_queue WHERE status='failed' GROUP BY category").all();
  const failureCategories = Object.fromEntries(failureRows.map((row) => [String(row.category), Number(row.count)]));
  const now = new Date().toISOString();
  const deferred = Number((db().prepare("SELECT COUNT(*) AS count FROM pdf_queue WHERE status='queued' AND next_attempt_at>?").get(now) as { count: number }).count);
  const openArchiveCircuits = db().prepare("SELECT archive_fsid AS archiveFsid,open_until AS openUntil,last_category AS failureCategory FROM archive_circuits WHERE open_until>? ORDER BY open_until").all(now);
  return { total: Object.values(counts).reduce((sum, value) => sum + value, 0), counts, failureCategories, deferred, openArchiveCircuits, current: current ?? null };
}
