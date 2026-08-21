import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { performance } from "node:perf_hooks";

const databasePath = process.env.GREENLENS_SQLITE_PATH?.trim()
  || path.join(process.cwd(), ".greenlens-runtime", "greenlens.sqlite");
const database = new DatabaseSync(databasePath, { readOnly: true });

function timed(label, sql, params = []) {
  const started = performance.now();
  const rows = database.prepare(sql).all(...params);
  return { label, milliseconds: Math.round((performance.now() - started) * 10) / 10, rows: rows.length };
}

function plan(label, sql, params = []) {
  return {
    label,
    plan: database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params).map((row) => String(row.detail)),
  };
}

const latestYear = Number(database.prepare("SELECT MAX(report_year) AS year FROM company_year_scores").get().year);
const companyIds = database.prepare("SELECT DISTINCT company_id FROM company_year_scores WHERE report_year=? LIMIT 100").all(latestYear)
  .map((row) => String(row.company_id));
const stockCodes = database.prepare("SELECT json_extract(payload,'$.stockCode') AS stock_code FROM company_year_scores WHERE report_year=? LIMIT 100").all(latestYear)
  .map((row) => String(row.stock_code));
const idPlaceholders = companyIds.map(() => "?").join(",");
const stockPlaceholders = stockCodes.map(() => "?").join(",");

const queries = [
  ["runtime revision counts", "SELECT (SELECT COUNT(*) FROM source_files),(SELECT COUNT(*) FROM financial_records),(SELECT COUNT(*) FROM company_year_scores),(SELECT COUNT(*) FROM company_industries),(SELECT COUNT(*) FROM esg_ratings),(SELECT COUNT(*) FROM violation_events),(SELECT COUNT(*) FROM evidence_items),(SELECT COUNT(*) FROM environmental_aspects),(SELECT COUNT(*) FROM pdf_documents),(SELECT COUNT(*) FROM gsi_scores),(SELECT COUNT(*) FROM reviews)"],
  ["current scores", "SELECT payload FROM company_year_scores WHERE report_year=?", [latestYear]],
  ["current industries", "SELECT payload FROM company_industries WHERE report_year=?", [latestYear]],
  ["direct dashboard filter", `SELECT s.payload FROM company_year_scores s WHERE s.report_year=? AND EXISTS (SELECT 1 FROM company_industries i WHERE i.company_id=s.company_id AND i.report_year=s.report_year AND COALESCE(NULLIF(json_extract(i.payload,'$.industryGroup'),''),NULLIF(json_extract(i.payload,'$.industryName'),''),'未分类')=(SELECT COALESCE(NULLIF(json_extract(payload,'$.industryGroup'),''),NULLIF(json_extract(payload,'$.industryName'),''),'未分类') FROM company_industries WHERE report_year=? LIMIT 1)) AND CASE WHEN LOWER(CAST(json_extract(s.payload,'$.riskLevel') AS TEXT)) LIKE '%high%' THEN 'high' WHEN LOWER(CAST(json_extract(s.payload,'$.riskLevel') AS TEXT)) LIKE '%medium%' THEN 'medium' WHEN LOWER(CAST(json_extract(s.payload,'$.riskLevel') AS TEXT)) LIKE '%low%' THEN 'low' ELSE 'unavailable' END='high'`, [latestYear, latestYear]],
  ["score histories", `SELECT payload FROM company_year_scores WHERE company_id IN (${idPlaceholders}) AND report_year<=?`, [...companyIds, latestYear]],
  ["financial histories", `SELECT payload FROM financial_records WHERE company_id IN (${idPlaceholders}) AND report_year<=? AND json_extract(payload,'$.fiscalPeriodEnd') LIKE '%-12-31' AND json_extract(payload,'$.reportType')='A'`, [...companyIds, latestYear]],
  ["PDF documents", `SELECT payload FROM pdf_documents WHERE json_extract(payload,'$.stockCode') IN (${stockPlaceholders}) AND CAST(json_extract(payload,'$.reportYear') AS INTEGER)=?`, [...stockCodes, latestYear]],
  ["evidence summaries", `SELECT company_id,report_year,COUNT(*) FROM evidence_items WHERE company_id IS NOT NULL AND report_year IS NOT NULL AND action_class IN ('implemented','planning','indeterminate') AND company_id IN (${idPlaceholders}) AND report_year=? GROUP BY company_id,report_year`, [...companyIds, latestYear]],
  ["evidence samples", `SELECT id,company_id,report_year FROM (SELECT id,company_id,report_year,ROW_NUMBER() OVER(PARTITION BY company_id,report_year ORDER BY id) rn FROM evidence_items WHERE company_id IS NOT NULL AND report_year IS NOT NULL AND company_id IN (${idPlaceholders}) AND report_year=?) WHERE rn<=12`, [...companyIds, latestYear]],
];

const counts = Object.fromEntries(database.prepare(`
  SELECT 'company_year_scores' AS table_name,COUNT(*) AS count FROM company_year_scores
  UNION ALL SELECT 'financial_records',COUNT(*) FROM financial_records
  UNION ALL SELECT 'company_industries',COUNT(*) FROM company_industries
  UNION ALL SELECT 'evidence_items',COUNT(*) FROM evidence_items
  UNION ALL SELECT 'pdf_documents',COUNT(*) FROM pdf_documents
`).all().map((row) => [String(row.table_name), Number(row.count)]));

const payloadSizes = Object.fromEntries([
  ["company_year_scores", "SELECT COUNT(*) AS rows,SUM(LENGTH(payload)) AS bytes,MAX(LENGTH(payload)) AS max_bytes FROM company_year_scores WHERE report_year=?"],
  ["financial_records", "SELECT COUNT(*) AS rows,SUM(LENGTH(payload)) AS bytes,MAX(LENGTH(payload)) AS max_bytes FROM financial_records WHERE report_year=?"],
  ["company_industries", "SELECT COUNT(*) AS rows,SUM(LENGTH(payload)) AS bytes,MAX(LENGTH(payload)) AS max_bytes FROM company_industries WHERE report_year=?"],
  ["pdf_documents", "SELECT COUNT(*) AS rows,SUM(LENGTH(payload)) AS bytes,MAX(LENGTH(payload)) AS max_bytes FROM pdf_documents WHERE CAST(json_extract(payload,'$.reportYear') AS INTEGER)=?"],
  ["evidence_items", "SELECT COUNT(*) AS rows,SUM(LENGTH(payload)) AS bytes,MAX(LENGTH(payload)) AS max_bytes FROM evidence_items WHERE report_year=?"],
].map(([table, sql]) => {
  const row = database.prepare(sql).get(latestYear);
  return [table, { rows: Number(row.rows), bytes: Number(row.bytes), maxBytes: Number(row.max_bytes) }];
}));

console.log(JSON.stringify({ databasePath, latestYear, sampledCompanies: companyIds.length, counts, payloadSizes, timings: queries.map(([label, sql, params]) => timed(label, sql, params)), plans: queries.map(([label, sql, params]) => plan(label, sql, params)) }, null, 2));
