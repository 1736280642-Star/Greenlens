# GreenLens Frontend Demo

GreenLens is a desktop-first ESG evidence investigation workspace. Deterministic tests use synthetic data; production-like local runs can also persist and parse a user-uploaded text PDF through the HTTP Repository.

> 演示数据：企业、事件、报告与指标均为合成内容，不代表任何真实主体。

## Run locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:3000/dashboard`, or use the currently verified workspace server at `http://127.0.0.1:3130/dashboard`.

The data source is selected once at the Repository composition root:

```bash
# Default fixed synthetic data
NEXT_PUBLIC_ANALYSIS_REPOSITORY=mock

# Real backend adapter
NEXT_PUBLIC_ANALYSIS_REPOSITORY=http
NEXT_PUBLIC_ANALYSIS_API_BASE_URL=/api/v1
```

## Quality gates

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e
```

The Playwright suite covers the investigation workflow, report success/OCR/failure paths, comparisons, review undo, serious accessibility violations, nonblank chart canvas, horizontal overflow, and screenshots at 1440x900, 1280x800, 768x1024, and 390x844.

## Routes

| Route | Purpose |
| --- | --- |
| `/dashboard` | Scan dense KPIs, EASS × E-AA-ESGSI, metric ledgers, industry heatmaps, and review operations |
| `/companies` | Search, sort, paginate, configure columns, compare, and export 30 synthetic companies |
| `/companies/cy-materials` | Inspect contributions, report evidence, external facts, ratings, and history |
| `/compare` | Compare 2-5 companies without producing a simplistic ranking |
| `/reports` | Upload a PDF, poll a persistent analysis job, and open linked evidence |
| `/review` | Record a human decision and undo it within 8 seconds |
| `/methodology` | Explain model logic, boundaries, and synthetic validation metrics |

## Implementation logic

- Pages obtain records only through `src/repositories/index.ts`; the composition root selects Mock or HTTP without page changes.
- Zustand persists filters, comparisons, reviews, and notifications in `localStorage`, but never stores identity or uploaded file contents.
- ECharts renders the EASS × E-AA-ESGSI quadrant, metric incidence, heatmaps, dumbbells, and operational charts; TanStack Table owns company sorting and filtering.
- `AnalysisRepository` has Mock and HTTP implementations; both validate metric, version, cross-field, and unavailable-value rules with Zod before data reaches a page.
- In HTTP mode, report scanning sends the selected PDF as multipart data. The Node backend validates and privately persists it, PDF.js extracts page text, and the existing evidence pipeline derives page-linked EASS/IR/UPR signals. Mock mode remains metadata-only for deterministic tests.
- Company and evidence queries include `reportYear`; URL parameters preserve company, tab, year, and evidence context for refreshable demonstrations.
- Review pages and drawers persist through `saveReview` before updating the local UI cache.

The underlying reason for these boundaries is migration cost: a real API can replace the Repository without rewriting route behavior, while risk, evidence quality, and review status remain distinct contracts. For users, this produces a coherent evidence trail and prevents a synthetic score from being mistaken for a verdict.

## Documentation

- [Metric contract v2](docs/metric-contract-v2.md)
- [Metric contract v1（历史）](docs/metric-contract-v1.md)
- [Design decisions](docs/design-decisions.md)
- [Mock data dictionary](docs/mock-data-dictionary.md)
- [Demo guide](docs/demo-guide.md)
- [Local PDF analysis MVP](docs/pdf-analysis-mvp.md)
- [Retrospective](docs/frontend_demo_retrospective.md)
