# Five-minute demo guide

## Primary investigation

1. Open `/dashboard` and keep report year `2025`.
2. Scan the compact KPI strip, action composition, risk distribution, and metric ledger without leaving the first viewport.
3. Select industry `新材料` or click `澄岳新材` in the low-EASS / high-EAA-ESI review quadrant.
4. Confirm the industry heatmap, metric incidence, and review queue change together.
5. Open the company analysis and select the `UPR 支撑要素不足` evidence.
6. Open `AI 证据助手`; verify raw value, numerator/denominator, threshold, and formula version before using citation `[1]`.
7. Start a review, choose `证据不足`, record an optional reason, and save.
8. Confirm the notification and changed pending-review count, then export the demo research summary.

## Report scan

1. Open `/reports` and choose any PDF. The page reads only its name, type, and size.
2. Select a non-default synthetic company and use a normal filename; verify the completion metrics and full-analysis link belong to that company-year.
3. Use `scan-demo.pdf` to demonstrate OCR recovery.
4. Use `broken-demo.pdf` to demonstrate the explicit failure message, then enable demo OCR.

Dashboard filters are Repository queries, not visual-only controls. Switching to an unavailable report year produces a directional empty state; `恢复默认视图` restores the 2025 synthetic sample.

## Comparison and reset

1. Select 2-5 companies in `/companies` and choose `开始对比`; the result stays inside the enterprise workflow at `/companies?view=compare&companies=...`.
2. Read core-metric dumbbells, action composition, and the real report/event timeline together; source-status chips distinguish imported metrics, linked report evidence, and queried history/event records.
3. Use `重置演示数据` in the sidebar to restore filters, comparison members, reviews, and notifications.

## PDF evidence completion

1. Open `/data-sources` and read the PDF evidence funnel from completed parsing through exact company-year linkage. The three exception counters distinguish missing text, unresolved identity, and unmatched score records.
2. Choose `预检查缺失证据` to estimate automatic linkage and manual review without writing data. Start the formal rebuild only after checking the preview; the page polls the durable background job and refreshes the funnel at completion.
3. Open `/data-sources/review` for unresolved company or report-year cases. Confirm a suggested entity or enter its stock code, add the four-digit report year, and rebuild from the already stored page text.
4. Return to a linked company-year. Its action composition and EASS/IR/UPR now use extracted document evidence, while ESI and EAA-ESI remain score-model outputs. Describe every result as a review signal rather than a confirmed greenwashing judgment.

## Presenter notes

- Say “risk signal” and “requires review,” never “confirmed greenwashing.”
- Keep EAA-ESI, evidence coverage, and review status conceptually separate.
- The evidence trace is the only expressive animation. Other transitions explain state or hierarchy.
