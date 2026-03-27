const net = require("node:net");
const path = require("node:path");

const { startServer } = require("next/dist/server/lib/start-server");
const loadConfig = require("next/dist/server/config").default;
const { PHASE_DEVELOPMENT_SERVER } = require("next/dist/shared/lib/constants");
const { setGlobal } = require("next/dist/trace/shared");

function checkPortAvailable(port, hostname) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.once("error", (error) => {
      if (error && error.code === "EADDRINUSE") {
        resolve(false);
        return;
      }

      reject(error);
    });

    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    server.listen(port, hostname);
  });
}

async function findAvailablePort(startPort, hostname, attempts = 10) {
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = startPort + offset;
    const available = await checkPortAvailable(port, hostname);

    if (available) {
      return port;
    }
  }

  throw new Error(`Could not find an available port between ${startPort} and ${startPort + attempts - 1}.`);
}

async function main() {
  process.env.LUMEN_NEXT_DIST_DIR = ".next-dev";

  const dir = process.cwd();
  const requestedPort = Number(process.env.PORT || 3000);
  const hostname = process.env.HOST || undefined;
  const config = await loadConfig(PHASE_DEVELOPMENT_SERVER, dir, {
    silent: false,
  });
  const port = process.env.PORT
    ? requestedPort
    : await findAvailablePort(requestedPort, hostname);

  if (port !== requestedPort) {
    console.log(`Port ${requestedPort} is busy, starting the dev server on http://localhost:${port} instead.`);
  }

  setGlobal("phase", PHASE_DEVELOPMENT_SERVER);
  setGlobal("distDir", path.join(dir, config.distDir || ".next"));

  await startServer({
    dir,
    port,
    allowRetry: false,
    isDev: true,
    hostname,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
