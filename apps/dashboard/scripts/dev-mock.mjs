// Runs the mock orchestrator (port 4000) and `next dev` (port 3000) together.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");

const procs = [
  spawn(process.execPath, ["mock/server.mjs"], { cwd: root, stdio: "inherit" }),
  spawn(process.execPath, [nextBin, "dev", "-p", "3000"], { cwd: root, stdio: "inherit" }),
];

const stop = () => {
  for (const p of procs) p.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const p of procs) p.on("exit", (code) => { if (code) stop(); });
