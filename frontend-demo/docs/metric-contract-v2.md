# Metric contract v2

## 1. Authority and purpose

This contract is the frontend and API boundary for the AI Greenwashing Radar research prototype. It is grounded in the project requirement to analyse Chinese listed-company ESG disclosures and preserve evidence, research reproducibility, and human judgment.

Version 2 replaces the ambiguous `rawValue` convention in v1 and adds the missing method, panel-audit, financial, violation-event, and history structures. All current frontend fixtures remain synthetic.

## 2. Metric value contract

Every metric returns three distinct values:

| Field | Meaning | Allowed range |
| --- | --- | --- |
| `rawValue` | Direct formula output before normalization | Metric-specific; may be negative or greater than 1 |
| `normalizedValue` | Comparable value after the declared rule | `[0,1]` |
| `riskValue` | Direction-aligned chart value | `[0,1]` |

Each metric also returns `formulaVersion`, `normalizationVersion`, `normalizationScope`, calculation status, evidence IDs, and numerator/denominator where applicable.

## 3. EAA-ESI method chain

User-facing names are `ESI` and `EAA-ESI` because the product analysis is environment-focused. Existing `ESGSI`, `EAA_ESI`, and `HIGH_ESGSI` identifiers remain compatibility codes for ingested source workbooks and API history; UI labels must not expose them as the product metric name.

```text
collect_ESG_reports
-> preprocess_text
-> extract_ESG_features
-> extract_environmental_aspects
-> calculate_aspect_salience
-> calculate_aspect_action_score
-> calculate_ESG_focus
-> calculate_ESG_imbalance
-> classify_environmental_action
-> calculate_EASS
-> calculate_IR
-> calculate_UPR
-> calculate_ESGSI
-> calculate_eaa_esi
-> risk_classification
```

### Aspect and action structure

Each company-year can expose `EnvironmentalAspectScore[]` with:

- five canonical environmental categories;
- aspect text, frequency and `salience`;
- implemented, planning and indeterminate counts;
- `planningAlpha` and aspect-level `actionScore`;
- evidence references and formula version.

When salience is frequency-based:

```text
AS_i = (Implemented_i + alpha * Planning_i)
       / (Implemented_i + Planning_i + Indeterminate_i)

EASS_c = sum(Salience_i * AS_i)
```

### Planning verification

UPR uses an explicit `PlanningVerificationSummary`. The v1 rule requires deadline, quantified target, implementation path, and responsible entity. Rule changes must create a new `ruleVersion`.

### Final index

```text
EAA_ESI_raw = ESGSI_normalized
                + lambdaAction * (1 - EASS)
                + lambdaIndeterminate * IR
                + lambdaPlanning * UPR
```

The API separately returns the final normalized value and its normalization scope/version.

### Robustness views

The Dashboard treats EAS / EAA-ESI as the primary analysis and exposes two robustness views in the same panel:

- GSI: a separate E/S/G dictionary-coverage model joined by company-year, with GSI final score, coverage penalty, imbalance, annual mean/median and quartiles;
- Red flag: threshold-trigger summaries derived from the primary model, not a third independent model.

Neither robustness view changes the primary risk band or constitutes a confirmed greenwashing judgment. Missing GSI matches remain `null`; they do not become zero and do not block the primary view.

## 4. Risk classification

The frontend does not recompute the risk band. The backend returns:

- `baseRisk`;
- four possible red flags: `HIGH_ESGSI`, `LOW_EASS`, `HIGH_IR`, `HIGH_UPR`;
- `assignedBand`;
- classification version and explanation.

Runtime validation checks that the returned band and classification object agree, but it does not enforce fixed `.33/.66` boundaries. This supports year-quantile, industry-year, and red-flag escalation policies without silently rewriting historical results.

## 5. Research panel audit fields

`PanelMetadata` preserves sample selection, `analysis_scope`, low-sentence warnings, duplicate resolution, quality flags, source workbook/sheet/row, code recovery, and company-year coverage. `PanelYearSummary` separately mirrors the `Year_summary` audit columns: source rows, unique company-years, duplicate groups/rows, three sample counts, target-year misses, quality-flagged rows, and recovered codes. These fields are required for regression reproducibility and should not be treated as decorative UI metadata.

## 6. Dedicated sub-resources

Do not overload `CompanyYearRecord` with long event, finance, aspect, or history arrays. The repository exposes:

```ts
listEnvironmentalAspects(companyId, reportYear)
getCompanyHistory(companyId, { fromYear, toYear, metrics })
getFinancialYear(companyId, reportYear)
listViolationEvents(companyId, { reportYear, fromYear, toYear })
listPanelYearSummaries({ fromYear, toYear })
```

### Financial-year fields

| Source field | Contract field |
| --- | --- |
| `F011201A` | `assetLiabilityRatio` |
| `F050201B` | `roaA` |
| `A001000000` | `totalAssets` |

The common source keys are `Stkcd`, `ShortName`, `Accper`, `Typrep`, and `Source`.

### Violation-event fields

The event contract separates announcement date, occurrence date, multiple violation years, type, reason, behaviour, action, authority, total penalty, listed-company penalty, relationship, subject, review status, and quality flags.

Stock codes are normalized to six digits. Multi-year strings such as `2019;2020;2021` become integer arrays. Missing penalties remain `null`, never zero.

## 7. HTTP endpoints

```text
GET /api/v1/company-years
GET /api/v1/company-years/:companyId
GET /api/v1/company-years/:companyId/evidence
GET /api/v1/company-years/:companyId/environmental-aspects
GET /api/v1/companies/:companyId/history
GET /api/v1/companies/:companyId/financials/:reportYear
GET /api/v1/companies/:companyId/violation-events
GET /api/v1/panel/year-summaries
GET /api/v1/dashboard/insights
POST /api/v1/analysis-jobs
GET /api/v1/analysis-jobs/:jobId
POST /api/v1/reviews
```

All endpoints pass through the same runtime schemas in mock and HTTP mode.

## 8. User impact

- Researchers can trace a final signal to formula inputs, aspects, actions and source evidence.
- True raw values are no longer rejected or disguised as percentages.
- Missing external events or penalties cannot be interpreted as zero risk.
- History charts consume company-year observations instead of generating substitute values in the page.
- Financial controls and violation events can be joined without flattening their different time semantics.
