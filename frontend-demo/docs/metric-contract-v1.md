# Metric contract v1

## Status and authority

This contract is the frontend-facing interpretation of the shared 12-function methodology. It supersedes the legacy `VAGUE / UNVERIFIED_TARGET / QUANT_GAP / DECOUPLING / SELECTIVE / EXTERNAL_FACT` demo score model.

The frontend consumes calculation results and never recomputes production scores. Synthetic fixtures use `calculationStatus: mock` and must expose the formula and threshold versions used to construct the example.

## Processing chain

```text
collect_ESG_reports
-> preprocess_text
-> extract_ESG_features
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

`calculate_eaa_esi` is the executable identifier. `EAA-ESI` remains the display label.

## Canonical fields

| Group | Fields | Scale / note |
| --- | --- | --- |
| Report | `companyId`, `reportYear`, `publishDate`, `reportId` | Identity and time stay separate |
| Text | `totalWords`, `sentenceCount`, `tokenCount` | Tokenizer version belongs to `featureVersion` |
| ESG topics | `eCount`, `sCount`, `gCount` | Non-negative counts |
| ESG focus | `eFocus`, `sFocus`, `gFocus` | Count divided by total words |
| Balance | `imbalanceScore` | `[0,1]`, formula pending confirmation |
| Actions | `implemented`, `planning`, `indeterminate`, `totalStatements` | Counts must reconcile |
| Metrics | `EASS`, `IR`, `UPR`, `ESGSI`, `EAA_ESI`, `IMBALANCE` | Raw and risk-direction values are separate |
| Risk | `finalIndex`, `riskBand` | Index `[0,1]`; UI may display percent |

Every metric returns `rawValue`, `riskValue`, numerator/denominator when applicable, formula version, calculation status, threshold, evidence IDs and an unavailable reason when it cannot be calculated.

Every company-year owns its evidence namespace. All six metrics must reference IDs returned by `listEvidence(companyId)`; cross-company evidence references are invalid.

## Formula status

| Metric | Current contract | Status |
| --- | --- | --- |
| EASS | `(implemented + alpha * planning) / total environmental statements` | `alpha` must be returned by backend |
| IR | `indeterminate / total environmental statements` | Defined |
| UPR | `unverified planning / planning statements` | Verification attributes still require a rule version |
| ESGSI | `positive ESG language - substantive ESG information` | Normalization and input construction pending |
| EAA-ESI | `ESGSI + action + indeterminate + planning penalties` | Penalty weights pending |
| Imbalance | Difference across E/S/G focus | Exact aggregation pending |

Zero denominators return `rawValue: null`, `riskValue: null`, `calculationStatus: unavailable`, and a plain-language `unavailableReason`. A temporarily unavailable final index also returns `finalIndex: null`, `riskBand: unavailable`, and a null formula-breakdown result. Missing values are displayed as `--` and are excluded from scored charts; they never become a fabricated zero.

## Risk thresholds

```text
low:    0 <= finalIndex <= 0.33
medium: 0.33 < finalIndex <= 0.66
high:   0.66 < finalIndex <= 1
```

The backend must return `thresholdVersion`. The frontend displays the returned band and does not reclassify it.

## API boundary

The frontend depends on `AnalysisRepository`. Mock and HTTP implementations share `listCompanies`, `getCompany`, `listEvidence`, `getDashboardInsights`, `createAnalysisJob`, `getAnalysisJob`, and `saveReview`. `getCompany` and `listEvidence` accept `reportYear`, so a company ID never silently selects the wrong annual record.

Required version fields are `schema`, `data`, `feature`, `model`, `score`, and `threshold`, plus `computedAt`.

Both Repository implementations run the runtime schema. It validates cross-field invariants: action counts reconcile to `totalStatements`; every company-year contains exactly one of each of the six canonical metrics; formula versions are non-empty; calculated and unavailable states have coherent values; `finalIndex`, the EAA-ESI raw value, and formula breakdown final value agree; and `riskBand` follows the `.33/.66` boundaries. This rejects internally inconsistent backend or fixture payloads before a page renders them.
