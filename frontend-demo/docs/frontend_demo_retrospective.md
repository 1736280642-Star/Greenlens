# Frontend demo retrospective

## Conclusion

The most effective interaction is the continuous evidence path: quadrant selection changes the metric ledger and queue, the ledger locates a report phrase, AI citations return to that phrase, and a human review updates shared state. This makes the product's value understandable without relying on a single score.

## What improved understanding

- The EASS-by-EAA-ESI quadrant answers who deserves attention and whether weak action substance aligns with a high final index.
- The dense Dashboard keeps KPI, action composition, formula breakdown, industry heatmap, and review operations within a compact scan path.
- Separate risk, evidence coverage, and review objects prevent low coverage from reading as low risk.
- Precise underlines preserve report readability better than full-paragraph highlighting.
- Cause-impact-next-action errors make report failure paths demonstrable rather than dead ends.
- Mobile deliberately keeps KPIs, telemetry, the main quadrant, formula ledger, diagnostics, and Top 3 review tasks while omitting queue throughput and governance charts that require desktop comparison space.

## What increased cognitive cost

- Showing the whole evidence matrix while loading initially produced misleading blank screenshots. The Playwright helper now waits for a nonblank Canvas before capture.
- The original muted token missed WCAG AA by a small margin on base surfaces and by more on selected rows. It was raised from `#6F7A75` to `#89958F` to guarantee at least 4.5:1 in the implemented states.
- Marketing-style MongoDB pills and large headings reduced data density, so they were not carried into the workbench.

## Real API migration

- Set `NEXT_PUBLIC_ANALYSIS_REPOSITORY=http` at the single Repository composition root while keeping `CompanyYearRecord`, `EvidenceItem`, and `ReviewRecord` stable.
- Keep runtime Zod validation at both Mock and HTTP boundaries so schema drift, duplicate metrics, invalid zero-denominator values, and incoherent unavailable states fail before rendering.
- Move query scenario behavior to test adapters, not production requests.
- Keep `saveReview` as the required write boundary; the current UI updates its local cache only after the Repository returns successfully. A production implementation may add optimistic updates with server reconciliation.
- Preserve URL state for year, tab, company, and evidence to retain shareable investigations.

The audit found that an interface alone was insufficient while pages still imported `demoRepository` directly, report results were hard-coded, global selection omitted `reportYear`, and Dashboard queue parameters were ignored by `/review`. All routes now consume `analysisRepository`; company, evidence, report, and review flows preserve company-year context; report progress is polled through `getAnalysisJob`; and review writes use `saveReview`. HTTP mode no longer requires route-by-route rewrites.

## Black glass tradeoffs

- Glass is limited to top-level tools and overlays; data panels use opaque surfaces for contrast and rendering stability.
- The background grid is restricted to Dashboard and company analysis.
- High-density tables need stronger dividers at 200% zoom; the high-contrast media query increases both divider and muted-text contrast.

## Reusable assets

The repeated acceptance workflow is automated in `tests/e2e/workflows.spec.ts`. Repository scenario handling, metric-contract validation, zero-denominator guards, evidence states, responsive audit layouts, and accessibility checks are reusable foundations for later API-backed iterations.

## Dashboard visual-system refactor · 2026-07-29

- Typography now ships with local `Noto Sans SC Variable`, `Space Grotesk Variable`, and `IBM Plex Mono` assets. The Dashboard readability gate was raised from 8px to 10px and covers the complete app shell, not only the command-center subtree.
- Dashboard colors were reduced to explicit roles: cyan for data and selection, coral for high-risk review signals, amber for pending or medium-risk states, green for verified or ready states, and violet only for GreenLens AI.
- The 3D constellation now derives its X/Y bounds from the filtered dataset, fills roughly 75%–80% of the stage, fits the orthographic camera to the live viewport, and uses industry, persistence, and evidence coverage to encode depth without changing the exact 2D fallback coordinates.
- Tablet switches the global search to an icon control, moves the synthetic-data notice into document flow, removes panel blur for lower compositing cost, and keeps the full analytical stack available through vertical scrolling. Mobile retains the intentionally reduced workflow.
- Chromium full-page screenshots can leave offscreen Canvas layers blank until scrolled into view. The release gate therefore combines viewport screenshots, explicit Canvas pixel checks, overflow checks, and a scrolled tablet review instead of treating a single long screenshot as ground truth.
- The release audit required upgrading Next.js to `16.2.12` and overriding its bundled `postcss`/`sharp` versions. Production dependencies now audit clean; forcing the separate development-only `brace-expansion` advisory to a new major broke legacy `minimatch`, so that unsafe override was explicitly rejected in favor of a stable lint toolchain.

## Dashboard green command-center refinement · 2026-07-30

- The first-view title now keeps only `HOLOGRAPHIC EVIDENCE OBSERVATORY`; removing the duplicate Chinese heading recovered vertical space without weakening the app-shell page title.
- Black-green surfaces and green coordinate light now cover the Dashboard panels, ECharts views, 2D risk field, and Three.js scene. Coral and amber remain reserved for risk meaning, blue-gray remains the low-risk node color, cyan is limited to the observatory identity, and violet remains AI-only.
- Compact KPI, construct, and watchlist modules show only definitions, entities, primary values, and graphics. Definitions, statistical scope, version metadata, and secondary explanations move into accessible detail dialogs.
- KPI values and construct values were enlarged by roughly 50%. The bottom section switches to two charts plus a full-width audit panel at 901–1599px, because three narrow audit columns caused label compression and made repeated review slower.
- Every non-KPI module exposes the same top-right full-view control. Expanded modules rerender at the available dialog size instead of scaling the compact view, and dialogs restore focus to their triggering control after Escape or close.
- Mobile retains the complete analytical stack through vertical scrolling. It no longer removes the bottom modules, and its full-view dialogs use the dynamic viewport while preserving the 10px minimum utility-copy floor.
- The synthetic-data notice enters document flow on Dashboard routes so it cannot cover chart labels or heatmap cells. Four-viewport Playwright checks now cover overflow, painted Canvas output, dialog interaction, and focus return.
- The page foundation now uses a near-black neutral base with only low-opacity green ambient light. Keeping the green density inside working panels creates clearer depth than applying the same green cast to both the page and its modules.
- The English observatory marker, four filters, contract version, operational state, export, and AI entry now share one toolbar row on desktop. Existing narrower layouts remain compatibility fallbacks rather than current design targets.

## Dashboard desktop release closure · 2026-07-30

- The accepted release targets are now `1440×900` and `1280×800`. A dedicated Playwright gate checks zero page-level scrolling, zero horizontal overflow, one-line toolbar alignment, and every primary/bottom panel boundary against the viewport.
- Route-specific CSS can visually collapse a sidebar even when React's manual `collapsed` state is false. Navigation accessibility must therefore live on the link itself, not depend on visible child text. Every navigation link now keeps an `aria-label`, `aria-current`, and title while the icon remains decorative.
- The Dashboard readability floor is 12px for normal, loading, empty, tooltip, legend, dialog, and Copilot states. Enlarging only the currently visible labels left latent regressions, so the automated gate covers all visible leaf text at runtime.
- The industry heatmap now uses a brighter scientific false-color ramp from blue-gray through green and amber to coral. Blue-gray prevents green from carrying both “environmental theme” and “low risk,” while brighter middle bands remain legible against the near-black panel.
- Production dependencies audit clean. ESLint 10 was tested as a possible fix for the development-only `brace-expansion` advisory, but the current Next.js React lint plugins are not ESLint 10 compatible. The compatible ESLint 9 toolchain is retained; force-fixing or overriding the transitive package is prohibited until upstream compatibility lands.

## Dashboard requirement recovery and large-desktop correction · 2026-07-30

- Visual references are not a substitute for product requirements. The old session's valid user statements were normalized into `dashboard-product-requirements-v2.md`, with each visual choice tied to a research task and an automated acceptance rule.
- `minmax(..., 1fr)` solved 1280×800 but over-expanded the primary analysis row at 2048×1227. The corrected layout uses a viewport-related row height capped at 520px, keeping modules contiguous while leaving optional space only after the complete analytical stack.
- A stale `.next/dev` chunk can make a running page disagree with the source tree. The reliable diagnosis is to compare visible copy with source, identify the exact listener process, clear only the active target's generated development cache, and verify the restarted server's DOM and geometry.
- Geometry-changing entrance animation made sequential browser measurements observe different frames. The command bar now fades without translation; staged panel motion remains short and never delays access to the controls.
- The release matrix now covers 1280×800, 1440×900, 1920×1080, and 2048×1227. It checks single-row alignment, no page overflow, no clipped top controls, no inter-module spacer, a 520px primary-row cap, painted Canvas output, and zero serious accessibility violations.

## Dashboard analytical-density correction · 2026-08-03

- A spatial visualization can remain the signature without owning half the screen. The primary row now stays between 320px and 430px, the risk field is capped at 46% of the three-column content width, and the bottom analytical row receives at least 240px.
- Large construct cards were visually full but informationally empty. Compact cards now combine median, attention rate, year-over-year change, valid sample count, and a trend trace so each occupied pixel supports a research judgment.
- Expanding a construct no longer magnifies the same sparse card. It adds the business definition, quartile range, trend coverage, and every annual median from 2016 through 2025; the trend plot expands to use the remaining vertical space.
- The added metadata made the former three-across tablet layout unreadable. Tablet compatibility now stacks the construct cards vertically, accepting more scrolling in exchange for complete labels and values; desktop remains the release target.
- Layout tests now block primary rows above 430px, bottom rows below 240px, risk-field width shares above 46%, and compact construct-card clipping.

## Dashboard risk-explanation closure · 2026-08-09

- A hexagonal glyph is not a hexbin. The main risk field now bins every non-empty coordinate cell, maps brightness to sample density and hue to median risk, and keeps threshold lines, axes, and grid visually subordinate to the data cloud.
- A waterfall must preserve visible arithmetic. Metric medians are rounded to the same percentage-point precision shown to users, each contribution starts at the previous cumulative value, and an explicit normalization step reconciles the displayed components with the final E-AA instead of hiding model calibration.
- “Persistent risk” needs visible time evidence. Watchlist rows now carry year-over-year direction and a three-year state band; selecting a company propagates to the watchlist row, hexbin halo, construct benchmarks, and waterfall company chip.
- Single-screen layout is a height-budget problem, not a scale-down problem. Header, toolbar, KPI, primary analysis, secondary analysis, gaps, and status bar now use bounded row formulas that retain 12px readable utility copy at both 1440×900 and 1280×800.
- Generated historical build and Playwright folders can make repository-wide lint report false failures. They are ignored as generated artifacts rather than deleted, preserving user-owned diagnostics while keeping the source gate meaningful.
- Playwright’s managed development server must use the same synthetic repository environment as manual validation. Reusing a server without `NEXT_PUBLIC_ANALYSIS_REPOSITORY=mock` produced unrelated data-flow failures; the final 32-test run used the release configuration and passed in full.

## Live Repository cutover · 2026-08-09

- Production-like local runs now default to the HTTP Repository; Mock is an explicit deterministic test mode. Keeping both modes behind the same runtime-validated contract prevents UI modules from branching on data origin.
- Data-origin language must be stateful. The top bar, data-source page, search actions, Copilot uncertainty copy, and document metadata no longer describe live records as synthetic or synthetic fixtures as live.
- `schema_pending` has different meanings for workbooks and documents. Workbook field mapping is now counted separately from PDF OCR requirements, so an OCR problem cannot be misreported as an unmapped spreadsheet.
- The live 2024 command-center response aggregates 2,136 company-year samples while the light payload sends 671 plotting nodes. Full-sample KPIs and sampled rendering preserve analytical totals without forcing every Canvas interaction to carry the entire cohort.
- Live visual gates and deterministic workflow gates are complementary: the former validates real scale, names, encoding, geometry, and accessibility; the latter protects repeatable report, review, and failure-path behavior.
- Repository cutover and evidence completion are separate release states. The Dashboard may read live scoring records while the external single-worker PDF queue still contains OCR-required, queued, or failed documents; the UI must expose that coverage gap instead of blocking all live analytics or treating missing evidence as zero risk.

## Evidence linkage migration

- Stock identity now crosses every Repository/PDF boundary as `stock-NNNNNN`; report year and file publication date are stored as separate fields.
- Annual-report evidence inherits the normalized company-year key of its source PDF. Failed PDF queue identities also participate in linkage diagnostics, so an identifiable parse failure is not mislabeled as an unlinked company.
- The local-only, idempotent v2 migration keeps a pre-migration SQLite/WAL/SHM backup, backfills all evidence keys in one transaction, and records its aggregate result in metadata. The migration revision participates in live-analysis cache invalidation because payload-only corrections do not change table row counts.
- Evidence health is intentionally split into three mutually exclusive states: unlinked, parse failed, and linked with coverage below 70%. This preserves the operational cause instead of compressing every gap into one misleading “insufficient evidence” number.

## Dashboard palette convergence · 2026-08-10

- Green was carrying surface, border, brand, positive, low-risk, selected, and chart-series meaning at once. The correction is permission-based: neutral teal owns structure, Cyan owns interaction, Green owns brand/online/low-risk, Amber owns warning/medium-risk, and Coral owns high-risk/red flags.
- Dashboard surfaces now use a dark-teal ladder (`#03090B` → `#06171A` → `#071C20` → `#082126`). Ordinary borders use low-opacity cyan-gray; only the Hexbin primary panel and selected state receive a Cyan edge.
- Hexbin opacity now follows fixed density bands rather than a nearly uniform relative range. Heatmap follows Deep Cyan → Aqua → Amber → Orange → Coral, so neither visualization resembles an olive or spreadsheet-green field.
- Waterfall semantics are calculation-aware: baseline is neutral Cyan, penalties Coral, decreases Aqua, normalization Blue, and Final E-AA is dynamically Low/Medium/High. A 53% final value is therefore Amber instead of Green.

## Enterprise comparison workflow consolidation · 2026-08-12

- Comparison is a task result, not a primary destination. The sidebar now exposes only the enterprise library; researchers select 2–5 companies there and enter the comparison result without changing product context.
- The result lives at `/companies?view=compare&companies=...`. Company IDs in the URL are the source of truth, so refresh and copied links preserve the same ordered cohort instead of depending only on persisted browser state.
- The legacy `/compare` route redirects to the enterprise library. Keeping a recoverable redirect prevents stale bookmarks from becoming dead ends without restoring a second navigation concept.
- Selection, comparison URL state, removal, and the return-to-library path form one reusable workflow. Future comparison views should extend the embedded `CompanyComparison` component rather than add another top-level route.

## Enterprise comparison simultaneous-view correction · 2026-08-17

- Tabs hid two-thirds of the comparison context and forced researchers to remember values across views. The result now mounts the metric dot plot, action composition, and report/event timeline together so cross-chart interpretation requires no mode switch.
- Single-screen comparison works best as one dominant analytical field plus two supporting fields: the six-row metric plot owns the left column, while action composition and timeline share the right column. Narrow screens retain all content by stacking the same three panels.
- The desktop height budget is verified at `1440×900` and `1280×800` with the maximum five-company cohort. Automated checks block page overflow and panels outside the viewport; alternating metric labels reduce collisions without changing the underlying values.
- A complete-looking chart can still be semantically empty. The 2024 score panel already supports EASS, IR, UPR, ESI, and EAA-ESI for 2,136 companies, while report-evidence linkage is still incomplete; source-status chips now expose that distinction instead of presenting zero evidence rows as measured zero activity.
- When evidence counts are unavailable, action shares can be recovered from the declared model identity `EASS = implemented + alpha × planning` and `IR = indeterminate`. The UI labels these as model proportions and never reports them as statement counts.
- The former timeline was decorative: it generated three fixed year labels without reading history or violations. It now uses `getCompanyHistory` and `listViolationEvents`, positions report years and announcement dates on a shared axis, and states zero recorded events explicitly.

## Local PDF analysis closure · 2026-08-17

- A progress animation is not a processing pipeline. Analysis jobs now advance only when the local Worker completes validation, page parsing, extraction, classification, calculation, and evidence linking; `GET` is read-only.
- Upload and evidence ingestion must share one document fact source. Browser uploads now enter the existing PDF page, evidence, aspect, and page-reference tables instead of creating a second upload-only schema.
- File persistence is what makes retry, deduplication, and audit possible. The MVP stores private bytes by SHA-256, keeps physical paths server-only, and binds results to parser, extractor, formula, and calculation versions.
- A partial model must stay partial. The uploaded document can produce EASS, IR, and UPR, but it reports EAA-ESI as unavailable until ESI and cohort normalization inputs are connected; missing inputs never become zero.
- Deterministic UI automation and real parsing tests serve different purposes. Playwright keeps the fast Mock success/OCR/failure stories, while Node integration tests process valid PDF bytes and verify the persistent Worker result.

## Stored-PDF evidence rebuild closure · 2026-08-17

- PDF parsing completion and research evidence completion are different states. The earlier UI counted completed queue items but could not prove that stored page text had passed identity resolution, evidence extraction, and exact company-year linkage; the new funnel makes every boundary measurable.
- Identity resolution must precede extraction. Mixing filename inference with sentence classification made retries non-auditable and allowed partial metadata to masquerade as linked evidence. The pure resolver now records its signals and confidence, while the extractor receives an explicit resolved identity.
- A rebuild is a data migration, not a page refresh. Per-document transactions, versioned evidence IDs, a durable job cursor, and three migration metadata keys make retries safe and cache invalidation observable without touching raw PDF bytes.
- Automation needs a human exception lane. Strong conflicts and unresolved identities remain visible, retain candidate context, and can be corrected by stock code and report year without downloading or OCRing the report again.
- Aggregate metrics should consume only evidence that can be defended. Live EASS, IR, and UPR switch to document-derived action counts only when such evidence exists; absent or unmatched inputs stay unavailable or retain the score workbook result rather than being silently converted to zero.
