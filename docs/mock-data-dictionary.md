# Mock data dictionary

## Data policy

Every company, stock code, report excerpt, violation event, financial record, source, rating, and metric in the demo is synthetic. Values are deterministic so refreshes, tests, and screenshots remain reproducible. Source links use `.invalid` domains.

## Core records

| Company ID | Synthetic company | Synthetic code | Industry | Report year |
| --- | --- | --- | --- | ---: |
| `cy-materials` | 澄岳新材 | 688217 | 新材料 | 2025 |
| `linhai-energy` | 林海能源 | 600741 | 综合能源 | 2025 |
| `qiming-mobility` | 启明交通 | 301482 | 交通设备 | 2025 |
| `beichen-foods` | 北辰食品 | 002761 | 消费品 | 2025 |
| `yuanfang-tech` | 远方科技 | 688903 | 电子制造 | 2025 |
| `jiuhe-build` | 九禾建设 | 601593 | 建筑 | 2025 |

The company library also contains 24 deterministic generated records, for 30 company-year records in total.

## Metric contract v2 objects

- `CompanyYearRecord`: report identity, text statistics, ESG focus, action classes, planning verification, score inputs, six metrics, formula breakdown, versioned risk classification, panel audit metadata, evidence quality, and review state.
- `AnalysisMetric`: raw, normalized, and risk-direction values plus formula and normalization versions.
- `EnvironmentalAspectScore`: one of five environmental Aspect categories, frequency, Salience, action counts, aspect action score, and evidence references.
- `CompanyMetricHistoryPoint`: repository-backed 2016–2025 company-year sequence. Pages never invent substitute history values.
- `FinancialYearRecord`: annual asset-liability ratio, ROA A, total assets, source field codes, period and quality flags.
- `ViolationEvent`: multi-year violations, separate occurrence/announcement dates, type, reason, action, authority, penalties, related subject, review status, and quality flags.
- `PanelYearSummary`: source-aligned yearly counts for source rows, unique company-years, duplicates, sample groups, target-year misses, quality flags, and recovered codes.
- `EvidenceItem`: report evidence or a compact external-event reference.
- `ReviewRecord`: model decision, human decision, reason, note, and timestamp.

All records use `metric-contract-v2` and are parsed by the same runtime schemas as HTTP responses. Missing values remain `null` with quality or unavailable reasons; they never become fabricated zeroes.

## Scenario controls

| Query | Behavior | User impact |
| --- | --- | --- |
| `?scenario=empty` | Repository returns no company records | Verifies directional empty-state recovery |
| `?scenario=error` | Repository rejects the request | Verifies cause, impact, and next-step error copy |
| `?scenario=slow` | Repository delay rises to 900ms | Verifies fixed layout during loading |

## Report scan filenames

| Filename contains | Behavior |
| --- | --- |
| any normal PDF name | Completes the synthetic analysis |
| `scan` | Pauses at text extraction and offers demo OCR recovery |
| `broken` | Fails at text extraction; demo OCR can recover |

The Mock Repository advances jobs through the same `getAnalysisJob` interface used by the HTTP adapter.
