import fs from "node:fs";
import path from "node:path";

const dirs = [
  ".next",
  ".next-mock",
  ".next-old-2",
  ".next-old-3",
  ".next-old-4",
  ".next-old-5",
  ".next-old-stale",
  ".next-prod",
  ".next-prod2",
  "pw-results",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const d of dirs) {
  const p = path.resolve(d);
  if (!fs.existsSync(p)) {
    console.log("absent  ", d);
    continue;
  }
  let ok = false;
  let last = "";
  for (let i = 0; i < 40; i++) {
    try {
      fs.rmSync(p, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 });
      ok = true;
      break;
    } catch (e) {
      last = `${e.code ?? ""} ${e.path ?? e.message}`;
      await sleep(400);
    }
  }
  console.log(ok ? "DELETED " : "FAILED  ", d, ok ? "" : ":: " + last);
}