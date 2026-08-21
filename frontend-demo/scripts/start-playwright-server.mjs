import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextCli = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
const env = {
  ...process.env,
  GREENLENS_E2E_BUILD: "1",
  NEXT_PUBLIC_ANALYSIS_REPOSITORY: "mock",
  NODE_ENV: "production",
};

function runNext(args) {
  return spawn(process.execPath, [nextCli, ...args], {
    cwd: projectRoot,
    env,
    stdio: "inherit",
  });
}

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

const buildResult = await waitForExit(runNext(["build"]));
if (buildResult.code !== 0) {
  process.exit(buildResult.code ?? 1);
}

const server = runNext(["start", "--hostname", "127.0.0.1", "--port", "3131"]);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.kill(signal));
}

const serverResult = await waitForExit(server);
if (serverResult.signal) {
  process.kill(process.pid, serverResult.signal);
} else {
  process.exit(serverResult.code ?? 1);
}
