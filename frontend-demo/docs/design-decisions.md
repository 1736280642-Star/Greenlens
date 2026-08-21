# GreenLens visual decisions

## Outcome

GreenLens is a desktop-first ESG risk interpretation workspace. Its primary job is to turn a company-year risk signal into a structured, cited and uncertainty-aware research brief; researchers interpret the business context and decide how the result may be used. Routine signal-by-signal review is automated, while human handling is reserved for data-quality exceptions and final research judgment.

## Token system

- Base: `#070A09`
- Raised surface: `#0C1110`
- Primary text: `#F4F7F5`
- Secondary text: `#A7B0AC`
- Selection and citation: `#27D7E5`
- Automatic interpretation: `#9A7AF5`
- Brand and verified: `#38D996`
- Data spectrum: cyan `#30D5E8`, blue `#5B8CFF`, yellow `#F4D35E`, orange `#FF9F43`, red `#FF5C6C`, magenta `#E879F9`
- UI type: Inter, Noto Sans SC, system sans-serif
- Data type: IBM Plex Mono, JetBrains Mono, monospace
- Radius: 6px panels and controls, 8px dialogs

## Typography readability floor

- Base interface copy: `15px`.
- Panel captions and supporting copy: `12-13px`, with `12px` as the enforced minimum for visible DOM text.
- Chart axes, legends, and point labels: `12px`; chart tooltips: `13px`.
- Dashboard exception: loaded operational copy and chart labels use a `16px` minimum without increasing the fixed first-row panel height.
- Data values and formula identifiers: `13px` or larger in the monospace role.
- Dense layouts may reduce padding or reorganize columns, but must not reduce operational copy below `12px`.
- The Playwright accessibility suite audits Dashboard, company library and detail, the comparison result embedded in the company workflow, reports, review, and methodology pages against this floor.

## Layout

```text
+--------------+-------------------------------------------------------+
| 216 sidebar  | 64 topbar                                             |
|              +-------------------------------------------------------+
| primary nav  | 48 context filters                                    |
|              +--------------------------------------+----------------+
| demo status  | compact KPI ledger + current contract/version          |
|              +----------------+----------------------+----------------+
|              | telemetry      | EASS x EAA-ESI  | formula ledger |
|              +----------------+----------------------+----------------+
|              | metric incidence | industry heatmap | diagnostics    |
+--------------+-------------------------------------------------------+
```

At 1024px the sidebar collapses. Below 768px navigation moves to the top; the Dashboard keeps decision-critical KPIs, telemetry, the main quadrant, formula ledger, diagnostics, and Top 3 review tasks, while queue throughput and governance charts are intentionally omitted.

## Signature

The EASS-by-EAA-ESI quadrant is the Dashboard's expressive motion surface. Selecting a point opens the same company-year context in AI Risk Interpretation.

The interpretation page's signature is the evidence ledger: each automatic finding is paired directly with a real report excerpt, page reference or external fact. Violet identifies generated interpretation, cyan identifies selection and citation, and risk colors remain limited to Aqua, Amber and Coral. Missing evidence is shown as unknown rather than filled with generated confidence.

`/review` remains the compatible entry URL for AI Risk Interpretation. Manual exception handling lives at `/data-sources/review` and only receives parsing, linkage, year, coverage, dispute or low-confidence anomalies.

The Dashboard deliberately uses a dense audit-console layout: compact KPI strip, three-column first row, three-column diagnostic row, and short chart headers. Density comes from shared axes, consistent risk direction, and aligned rows rather than smaller unreadable type.

## Design critique

The neutral dark-teal shell and disciplined accent roles fit the product, while a green-tinted interface, marketing typography, universal pills, large-radius cards, and generous landing-page whitespace do not. The interpretation layout keeps company prioritization separate from the research narrative, then becomes a single-column evidence flow below 1000px.
