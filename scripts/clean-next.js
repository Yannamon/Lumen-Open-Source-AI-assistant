const fs = require("node:fs");
const path = require("node:path");

const targetPath = path.join(process.cwd(), ".next");
const maxAttempts = 8;
const retryDelayMs = 250;

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function shouldRetry(error) {
  return ["EBUSY", "ENOTEMPTY", "EPERM"].includes(error?.code);
}

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
    process.exit(0);
  } catch (error) {
    if (!shouldRetry(error) || attempt === maxAttempts) {
      console.error(
        `Failed to remove ${targetPath} after ${attempt} attempt${attempt === 1 ? "" : "s"}: ${error.message}`
      );
      process.exit(1);
    }

    sleep(retryDelayMs * attempt);
  }
}
