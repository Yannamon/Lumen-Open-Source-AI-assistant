const fs = require("node:fs");
const path = require("node:path");

function copyDirectory(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) {
    return;
  }

  fs.mkdirSync(targetDir, { recursive: true });

  fs.readdirSync(sourceDir, { withFileTypes: true }).forEach((entry) => {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
      return;
    }

    fs.copyFileSync(sourcePath, targetPath);
  });
}

const sourceDir = path.join(process.cwd(), ".next", "server", "vendor-chunks");
const targetDir = path.join(
  process.cwd(),
  ".next",
  "standalone",
  ".next",
  "server",
  "vendor-chunks"
);

copyDirectory(sourceDir, targetDir);
