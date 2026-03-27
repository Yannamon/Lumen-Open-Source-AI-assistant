const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const requiredServerFilesPath = path.join(
  process.cwd(),
  ".next",
  "required-server-files.json"
);
const standaloneServerPath = path.join(
  process.cwd(),
  ".next",
  "standalone",
  "server.js"
);
const devServerPath = path.join(process.cwd(), "scripts", "dev-server.js");

function spawnNodeScript(scriptPath, args = [], env = process.env) {
  return childProcess.spawn(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    stdio: "inherit",
    env,
  });
}

function startDevServer() {
  if (!fs.existsSync(devServerPath)) {
    console.error("Could not find the development server launcher.");
    process.exit(1);
  }

  const child = spawnNodeScript(devServerPath, process.argv.slice(2), {
    ...process.env,
    NODE_ENV: "development",
  });

  child.on("error", (error) => {
    console.error(error.message || error);
    process.exit(1);
  });

  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });

  return child;
}

const hasProductionBuild =
  fs.existsSync(requiredServerFilesPath) && fs.existsSync(standaloneServerPath);

if (!hasProductionBuild) {
  startDevServer();
  return;
}

const child = spawnNodeScript(standaloneServerPath, process.argv.slice(2));

child.on("error", (error) => {
  if (error?.code === "ENOENT") {
    startDevServer();
    return;
  }

  console.error(error.message || error);
  process.exit(1);
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
