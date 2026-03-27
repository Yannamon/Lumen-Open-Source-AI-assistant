const fs = require("node:fs");
const childProcess = require("node:child_process");

function run(command, args, env = process.env) {
  const result = childProcess.spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const cachePath = "tsconfig.tsbuildinfo";
try {
  fs.rmSync(cachePath, { force: true });
} catch (error) {
  console.error(`Failed to reset ${cachePath}: ${error.message}`);
  process.exit(1);
}

const nextBin = require.resolve("next/dist/bin/next");
const tscBin = require.resolve("typescript/bin/tsc");

run(process.execPath, [nextBin, "typegen"]);
run(process.execPath, [nextBin, "typegen"], {
  ...process.env,
  LUMEN_NEXT_DIST_DIR: ".next-dev",
});
run(process.execPath, [tscBin, "--noEmit", "--incremental", "false"]);
