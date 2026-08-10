// Reads the 13 annual EAA-ESI score workbooks (synced copy of the Baidu Netdisk
// "EAA" folder) and publishes their rows through the GreenLens ingest API.
// Usage: node scripts/ingest-eaa-scores.mjs [baseDir] [ingestUrl]
import { statSync } from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

const baseDir = path.resolve(process.argv[2] ?? "C:\\Users\\86133\\Desktop\\greenwashing");
const ingestUrl = process.argv[3] ?? "http://127.0.0.1:3030/api/v1/data-sources/baidu-netdisk/ingest";
const sessionId = `eaa-panel-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
const maxRowsPerBatch = Number(process.env.EAA_BATCH_ROWS ?? 800);

const years = Array.from({ length: 13 }, (_, index) => 2012 + index);
const files = [];
for (const year of years) {
  const filePath = path.join(baseDir, String(year), `company_level_scoring_${year}_EAA_ESI.xlsx`);
  const size = statSync(filePath).size;
  const workbook = XLSX.readFile(filePath, { cellDates: true, raw: true });
  const sheetName = workbook.SheetNames.find((name) => /company[-_ ]?level scoring/i.test(name));
  if (!sheetName) throw new Error(`Missing scoring sheet in ${filePath}`);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null, raw: true, blankrows: false });
  files.push({ fsid: `local-eaa-${year}`, filename: path.basename(filePath), size, rows });
  console.log(`[prepare] ${path.basename(filePath)} -> ${rows.length} rows`);
}

const totalRows = files.reduce((sum, file) => sum + file.rows.length, 0);
console.log(`[plan] ${files.length} workbooks, ${totalRows} rows, batch size ${maxRowsPerBatch}, session ${sessionId}`);

const batches = [];
let pending = [];
let pendingRows = 0;
for (const file of files) {
  for (const row of file.rows) {
    pending.push({ file, row });
    pendingRows += 1;
    if (pendingRows >= maxRowsPerBatch) {
      batches.push(pending);
      pending = [];
      pendingRows = 0;
    }
  }
}
if (pending.length) batches.push(pending);

async function postBatch(entries, complete) {
  const byFile = new Map();
  for (const { file, row } of entries) {
    const current = byFile.get(file.fsid) ?? { ...file, rows: [] };
    current.rows.push(row);
    byFile.set(file.fsid, current);
  }
  const body = { sessionId, complete, files: [...byFile.values()] };
  const response = await fetch(ingestUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`[error] batch failed (${response.status})`, payload);
    process.exit(1);
  }
  return payload;
}

for (let index = 0; index < batches.length; index += 1) {
  const complete = index === batches.length - 1;
  const payload = await postBatch(batches[index], complete);
  if (complete) {
    console.log("[done]", JSON.stringify(payload, null, 2));
  } else {
    console.log(`[batch] ${index + 1}/${batches.length} accepted ${payload.acceptedRows}`);
  }
}
console.log(`[summary] session ${sessionId} staged; verify via /api/v1/data-sources/baidu-netdisk/records`);
