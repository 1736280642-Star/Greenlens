# Evidence linkage automation

`scripts/orchestrate-evidence-linkage.mjs` runs the stored-PDF evidence linkage workflow without keeping the Data Sources page open.

## Workflow

1. Poll the local PDF queue until `queued` and `running` remain at zero for two consecutive checks.
2. Preview the `missing_only` evidence scope.
3. Start the formal missing-evidence reindex and poll its durable job record to completion.
4. Resolve only identity exceptions that have all three deterministic signals:
   - exactly one six-digit stock code in the filename;
   - an explicit report year in the filename;
   - exactly one matching identity candidate and an existing company-year score.
5. Preview the remaining `failed_only` scope and write an aggregate summary. The automation does not fabricate evidence, change a report year to fit a score, or bypass source-download security checks.

## Runtime records

Runtime state is written under the ignored `.greenlens-runtime/evidence-linkage-orchestrator/` directory:

- `process.json`: current process and terminal status;
- `events.ndjson`: aggregate progress events without document text or credentials;
- `summary.json`: final queue, linkage-coverage, and exception counts;
- `stdout.log` / `stderr.log`: detached process output.

The workflow is idempotent: `missing_only` skips documents that already have evidence, and exact company-year matching remains the linkage gate.

## Failure handling

- `NO_ENVIRONMENTAL_EVIDENCE`: keep as an extraction exception until the source text or extractor changes; do not create a zero-valued record.
- `SCORE_UNMATCHED`: preserve extracted evidence, but keep it outside live company-year metrics until the exact score record exists.
- ambiguous identity: leave for human judgment unless the deterministic conditions above become true.
- PDF acquisition or parsing failure: fix the source-specific cause before a targeted retry.
