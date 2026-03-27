const fs = require("node:fs");
const path = require("node:path");

const cachePath = path.join(process.cwd(), "tsconfig.tsbuildinfo");

try {
  fs.rmSync(cachePath, { force: true });
} catch (error) {
  console.error(`Failed to reset ${cachePath}: ${error.message}`);
  process.exit(1);
}
