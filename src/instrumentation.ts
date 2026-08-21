export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // Browsing the dashboard should not implicitly resume CPU/memory-heavy
  // evidence maintenance. Operators can opt in for dedicated worker runs.
  if (process.env.GREENLENS_RESUME_REINDEX_ON_START !== "1") return;
  // Never resume background reindex work during a production build: it keeps
  // static-generation workers alive with pending timers and hangs `next build`.
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const { resumeEvidenceReindexRuns } = await import("./server/netdisk/evidence-reindex");
  resumeEvidenceReindexRuns();
}
