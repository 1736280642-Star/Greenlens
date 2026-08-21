import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import * as XLSX from "xlsx";

const sourcePath = process.argv[2] ? path.resolve(process.argv[2]) : null;
if (!sourcePath || !existsSync(sourcePath)) {
  throw new Error("用法：npm run import:gsi -- <GSI_Final_Results_Fixed.csv 路径>");
}

const csvText = readFileSync(sourcePath, "utf8").replace(/^\uFEFF/, "");
const dataVersion = `GSI-${createHash("sha256").update(csvText).digest("hex").slice(0, 12)}`;
const workbook = XLSX.read(csvText, { type: "string", raw: true });
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { defval: null, raw: true });
const importedAt = new Date().toISOString();

function number(value, field, rowIndex) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`第 ${rowIndex} 行字段 ${field} 不是有效数字。`);
  return parsed;
}

function stockCode(value, rowIndex) {
  const digits = String(value ?? "").match(/\d{1,6}/)?.[0];
  if (!digits) throw new Error(`第 ${rowIndex} 行缺少公司代码。`);
  return digits.padStart(6, "0");
}

function id(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

const normalized = rows.map((row, index) => {
  const sourceRow = index + 2;
  const code = stockCode(row["公司代码"], sourceRow);
  const reportYear = number(row["年份"], "年份", sourceRow);
  if (!Number.isInteger(reportYear) || reportYear < 2000 || reportYear > 2100) {
    throw new Error(`第 ${sourceRow} 行年份 ${reportYear} 超出允许范围。`);
  }
  const totalWords = number(row["总词数"], "总词数", sourceRow);
  const eCount = number(row.E_count, "E_count", sourceRow);
  const sCount = number(row.S_count, "S_count", sourceRow);
  const gCount = number(row.G_count, "G_count", sourceRow);
  const eFocus = number(row.E_focus, "E_focus", sourceRow);
  const sFocus = number(row.S_focus, "S_focus", sourceRow);
  const gFocus = number(row.G_focus, "G_focus", sourceRow);
  const imbalance = number(row.Imbalance, "Imbalance", sourceRow);
  const gwScore = number(row.GW_score, "GW_score", sourceRow);
  const coveragePenalty = number(row.coverage_penalty, "coverage_penalty", sourceRow);
  const gsiFinal = number(row.GSI_final, "GSI_final", sourceRow);
  const companyName = String(row["公司名"] ?? code).trim() || code;
  return {
    id: id(`gsi:${code}:${reportYear}`),
    companyId: `stock-${code}`,
    stockCode: code,
    companyName,
    reportYear,
    totalWords,
    eCount,
    sCount,
    gCount,
    eFocus,
    sFocus,
    gFocus,
    imbalance,
    gwScore,
    coveragePenalty,
    gsiFinal,
    duplicateCount: 1,
    qualityFlags: [],
    calculationStatus: "calculated",
    modelVersion: "gsi-fixed-v1",
    dataVersion,
    sourceFile: path.basename(sourcePath),
    sourceRow,
    importedAt,
  };
});

const grouped = new Map();
for (const record of normalized) {
  const key = `${record.stockCode}:${record.reportYear}`;
  const group = grouped.get(key) ?? [];
  group.push(record);
  grouped.set(key, group);
}

const selected = [...grouped.values()].map((group) => {
  group.sort((left, right) => right.totalWords - left.totalWords || left.sourceRow - right.sourceRow);
  const record = { ...group[0], duplicateCount: group.length, qualityFlags: [] };
  if (group.length > 1) record.qualityFlags.push("GSI_DUPLICATE_COMPANY_YEAR_SELECTED_LONGEST_TEXT");
  if (record.totalWords < 500) record.qualityFlags.push("GSI_LOW_TEXT_VOLUME");
  if (record.eCount + record.sCount + record.gCount === 0) record.qualityFlags.push("GSI_ZERO_ESG_COVERAGE");
  if (record.coveragePenalty >= 0.9) record.qualityFlags.push("GSI_HIGH_COVERAGE_PENALTY");
  return record;
});

const runtimeDirectory = path.join(process.cwd(), ".greenlens-runtime");
const databasePath = process.env.GREENLENS_SQLITE_PATH?.trim() || path.join(runtimeDirectory, "greenlens.sqlite");
mkdirSync(path.dirname(databasePath), { recursive: true });
const database = new DatabaseSync(databasePath);
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS gsi_scores (
    record_key TEXT PRIMARY KEY,
    id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    report_year INTEGER NOT NULL,
    gsi_final REAL NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_gsi_company_year ON gsi_scores(company_id, report_year);
`);

database.exec("BEGIN IMMEDIATE");
try {
  database.exec("DELETE FROM gsi_scores");
  const insert = database.prepare("INSERT INTO gsi_scores(record_key,id,company_id,report_year,gsi_final,payload) VALUES(?,?,?,?,?,?)");
  for (const record of selected) {
    insert.run(`${record.stockCode}:${record.reportYear}`, record.id, record.companyId, record.reportYear, record.gsiFinal, JSON.stringify(record));
  }
  database.prepare("INSERT INTO metadata(key,value) VALUES('gsi_data_version',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(dataVersion);
  database.prepare("INSERT INTO metadata(key,value) VALUES('gsi_imported_at',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(importedAt);
  database.exec("COMMIT");
} catch (error) {
  database.exec("ROLLBACK");
  throw error;
} finally {
  database.close();
}

const years = selected.map((record) => record.reportYear);
const duplicateGroups = selected.filter((record) => record.duplicateCount > 1).length;
console.log(JSON.stringify({
  databasePath,
  dataVersion,
  sourceRows: normalized.length,
  importedCompanyYears: selected.length,
  duplicateGroups,
  firstYear: Math.min(...years),
  lastYear: Math.max(...years),
}, null, 2));
