# Baidu Netdisk data-source contract

## Boundary

The browser never calls Baidu Netdisk directly. The backend connector reads file metadata and content, normalizes records, and exposes the existing analysis resources. This protects permissions, keeps raw documents out of the browser, and makes sync failures recoverable.

## Persistent ingestion

GreenLens persists normalized Netdisk data in `.greenlens-runtime/greenlens.sqlite`. SQLite uses WAL mode so the MCP queue worker and the Next.js backend can safely share the database. The legacy `netdisk-data.json` file is read once for migration and is never rewritten.

Run `POST /api/v1/data-sources/baidu-netdisk/sync` after the desktop client finishes syncing. The first implementation reads `.xlsx` and `.xls` files, stores discovered headers, and populates the financial and violation-event query resources in runtime memory. Raw document text is never returned to the browser.

Large ZIP archives are exposed as read-only virtual directories by the local MCP. The connector reads the ZIP central directory and selected compressed PDF members through bounded HTTP Range requests. It never downloads or unpacks the complete archive. Each member receives a stable composite source id (`zip:<archive-fsid>:<member-hash>`) and enters the same persistent PDF queue as a directly stored Netdisk PDF.

`ingest_greenlens_pdf_directory(directory)` only enumerates metadata and enqueues `fsid` values. A globally leased, process-backed single worker reads one PDF at a time, extracts pages in memory, submits bounded page batches, and releases the source bytes after every file. Queue state and worker ownership survive MCP, backend, and Codex restarts. Fast-lane ESG reports run before retries, oversized documents, and negative-news compilations; timed-out documents move to the Slow lane instead of blocking normal reports.

`ingest_greenlens_zip_directory(directory)` recursively discovers ZIP archives, reads only their central directories, and enqueues safe PDF members as `archive_fsid + member_path` jobs. The worker fetches and inflates one member at a time while reusing the same download descriptor, HTTP session, central directory, and bounded Range cache for a configurable batch from one archive. Encrypted members require an MCP-only `GREENLENS_ZIP_PASSWORD`; unsafe paths, excessive compression ratios, oversized members, non-PDF signatures, and servers without Range support are rejected without a full-download fallback.

Required runtime values:

```text
GREENLENS_SQLITE_PATH=<optional absolute path; both processes must use the same value>
GREENLENS_PDF_WORKER_AUTOSTART=true
GREENLENS_PDF_MAX_SIZE_MB=25
GREENLENS_BACKEND_DOCUMENT_INGEST_URL=http://127.0.0.1:3030/api/v1/data-sources/baidu-netdisk/document-ingest
```

## Source-file metadata

`SourceFileRecord` stores file discovery fields: `fsid`, `path`, `filename`, `md5`, `size`, `kind`, `parseStatus`, timestamps, detected columns, and quality flags. It is an ingestion record, not a research result.

## Field mapping

The finance normalizer maps the known workbook conventions below. The connector must inspect the actual sheet headers before marking a file `ready`.

| Source field | Greenlens field | Type |
| --- | --- | --- |
| `Stkcd` | `stockCode` | string, normalized to six digits |
| `ShortName` | `companyName` | string |
| `Accper` | `fiscalPeriodEnd` / `reportYear` | date |
| `F011201A` | `assetLiabilityRatio` | number |
| `F050201B` | `roaA` | number |
| `A001000000` | `totalAssets` | number |

Violation workbooks are field-discovered before mapping. The backend must retain source row and sheet references, normalize multi-year values to `violationYears: number[]`, and keep missing penalties as `null`.

ESG reports and negative-news files are document sources. Their text must be extracted server-side and then converted into `EvidenceItem`, environmental aspects, and calculated company-year metrics. A missing downloadable text stream or OCR failure must produce `parseStatus: failed` and a recoverable sync error; it must not create a zero-valued metric.

## Company score workbooks (EAA-ESI)

Annual `company_level_scoring_YYYY_EAA_ESI.xlsx` workbooks contain model-level company scores for the report year `YYYY`. They are classified as `company_score_workbook` when the filename matches `score` / `EAA_ESI`, or when the discovered headers contain `stock_code` plus `EAA_ESI_raw` / `ESGSI_raw`.

The full-sample `Company-level scoring` sheet is the ingestion source. Column mapping:

| Source field | Greenlens field | Notes |
| --- | --- | --- |
| `stock_code` | `stockCode` | recovered from the leading six digits of the `company` label when the column is absent (e.g. the 2017 workbook) |
| `company_short` | `companyName` | |
| `year` | `reportYear` | fallback to the year in the filename, then the `YYYY年度` in the `company` title |
| `EASS` / `IR` / `UPR` | same | already 0-1 ratios |
| `sentiment_raw` / `sentiment_norm` | `sentimentRaw` / `sentimentNorm` | |
| `sustainability_raw` / `sustainability_norm` | `sustainabilityRaw` / `sustainabilityNorm` | |
| `ESGSI_raw` / `ESGSI_norm` | `esgsiRaw` / `esgsiNorm` | |
| `EAA_ESI_raw` / `EAA_ESI_norm` | `eaaEsiRaw` / `eaaEsiNorm` | `EAA_ESI_norm` becomes `finalIndex` / `EAA_ESI` in company-year records |
| `base_risk`, `risk_level`, flags, `recommended_use` | risk classification | `risk_level` maps to the frontend risk band |

Rows are deduplicated by `stockCode:reportYear`, preferring `selected_for_panel`, then the main `n_ge_20` sample, then higher environmental sentence counts. Records persist in the `company_year_scores` table and are exposed to the analysis endpoints as company-year records; PDF evidence, financial records and violation events remain separate review inputs.

## GSI robustness data

GSI is a separate robustness model, not another name for the EAS / EAA-ESI primary model. Import the reviewed final CSV into the runtime database with:

```text
npm run import:gsi -- <path-to-GSI_Final_Results_Fixed.csv>
```

The importer strips a UTF-8 BOM, normalizes `公司代码` to six digits, validates all numeric fields, and hashes the source content into a `GSI-<sha>` data version. It maps:

| Source field | GreenLens field |
| --- | --- |
| `公司代码` / `公司名` / `年份` | `stockCode` / `companyName` / `reportYear` |
| `总词数` | `totalWords` |
| `E_count` / `S_count` / `G_count` | `eCount` / `sCount` / `gCount` |
| `E_focus` / `S_focus` / `G_focus` | `eFocus` / `sFocus` / `gFocus` |
| `Imbalance` | `imbalance` |
| `GW_score` | `gwScore` |
| `coverage_penalty` | `coveragePenalty` |
| `GSI_final` | `gsiFinal` |

Records persist in `gsi_scores` and join to primary records only by normalized `companyId:reportYear`. Duplicate company-years select the row with the largest `totalWords`, then the earliest source row, while retaining `duplicateCount` and a quality flag. GSI import replaces only `gsi_scores`; it does not rewrite company scores, evidence, reviews, or raw source files. The CSV and database remain under ignored `.greenlens-runtime/` storage and are never sent to the browser as raw data.

## Company-industry mapping

`company_industry_panel_2012_2024.csv` maps every EAA company-year to a CSRC-2012 industry. Sources in priority order: CSMAR ListedCoInfoAnl (Shangdao/Runling, exact company-year), HuaZheng annual (`证监会行业新`), then MSCI (`行业名称`). Missing years are backfilled from the company's nearest available year and flagged `backfilled`; companies with no industry in any source are omitted (rendered as "未分类"). Each row also carries an `industry_group` column that collapses the 80+ CSRC sub-industries into ten top-level groups (`工业制造/材料化工/消费服务/信息技术/金融地产/能源公用/医药健康/交通运输/建筑建材/农林牧渔`, plus `综合` and `未分类`). The builder lives in `scripts/build_company_industry.py` and coverage is audited against the `company_year_scores` table (99.2% for the 2012-2024 panel). Records persist in the `company_industries` table; company-year records and the Dashboard heatmap expose `industryGroup` while `industryName` keeps the sub-industry detail, and `GET /api/v1/industries` serves the distinct group list for filters.

## External ESG ratings

`esg_ratings_panel.csv` is a unified company-year rating panel from eleven vendors (CSMAR Shangdao/Runling, Wind Shangdao, HuaZheng, MSCI, Bloomberg, CNRDS, Wind ESG, MengLang, FTSE Russell, Hexun). Each row keeps the vendor, stock code, report year, rating text, score and E/S/G subscores with the vendor's score scale; CSMAR/Wind Shangdao rating years are mapped to report years (`rating year - 1`). The builder is `scripts/build_esg_ratings.py`. Records persist in the `esg_ratings` table, are exposed through `/api/v1/companies/:id/esg-ratings`, and are rendered in the company detail "评级分歧" tab and the data-sources summary.

## HTTP resources

```text
GET  /api/v1/data-sources/baidu-netdisk/status
GET  /api/v1/data-sources/baidu-netdisk/pdf-queue
GET  /api/v1/data-sources/baidu-netdisk/files?path=&kind=&parseStatus=
GET  /api/v1/data-sources/baidu-netdisk/files/:sourceFileId/fields
POST /api/v1/data-sources/baidu-netdisk/sync
POST /api/v1/data-sources/baidu-netdisk/document-ingest
GET  /api/v1/data-sources/baidu-netdisk/sync-jobs/:jobId
GET  /api/v1/data-sources/baidu-netdisk/evidence-reindex
POST /api/v1/data-sources/baidu-netdisk/evidence-reindex
GET  /api/v1/data-sources/baidu-netdisk/evidence-reindex/:jobId
POST /api/v1/data-sources/baidu-netdisk/evidence-reindex/documents/:documentId/resolve
```

`POST /sync` accepts an optional `path` and `inspectSchemas` flag. It only schedules server-side discovery and parsing; the resulting company-year records remain available through the existing analysis endpoints.

## Stored-PDF evidence rebuild

Evidence rebuild is a second-stage operation over completed `pdf_documents` and `pdf_pages`; it never downloads a PDF or reruns OCR. The processing funnel is measured as completed PDFs → stored documents → readable page text → resolved company/report year → extracted evidence → exact company-year score linkage. Missing text, ambiguous identity, extraction failure, and score mismatch remain separate operational states instead of becoming zero-valued evidence.

`pdf_evidence_jobs` stores one durable document state with identity confidence, resolution sources, extractor version, evidence count, linkage state, and actionable failure detail. `evidence_reindex_runs` stores the batch cursor and aggregate progress. `POST /evidence-reindex` is local-only, defaults to `dryRun: true`, accepts `missing_only`, `failed_only`, or `version_outdated`, and limits each page to 1–50 documents. Formal jobs are backgrounded and polled through the job resource.

Company and year resolution combines normalized score aliases, metadata, filename stock codes, report-cover text, publication date, and unique score years. Extraction runs only after identity resolution and writes `documentId`, page hash, and `extractorVersion` to every evidence item. Document replacement is transactional and idempotent: generation failure preserves the last valid evidence set, while a successful rebuild atomically replaces only that document's evidence and aspects. Exact `companyId:reportYear` matching controls whether evidence contributes to live company-year action metrics.

Ambiguous documents are exposed in `/data-sources/review`. A reviewer can choose a suggested entity or enter a six-digit stock code / canonical `stock-NNNNNN` ID, confirm the report year, and reuse the stored pages immediately. Migration metadata records `evidence_extraction_backfill_v3`, `evidence_linkage_keys_v3`, and `aggregate_company_year_evidence_v3` after a completed run.
