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

async function main() {
  const dir = process.cwd();
  const port = Number(process.env.PORT || 3000);
  const hostname = process.env.HOST || undefined;
  const available = await checkPortAvailable(port, hostname);

  if (!available) {
    console.log(
      `Port ${port} is already in use. Lumen may already be running at http://localhost:${port}.`
    );
    return;
  }

  process.env.LUMEN_NEXT_DIST_DIR = ".next-dev";

  const config = await loadConfig(PHASE_DEVELOPMENT_SERVER, dir, {
    silent: false,
  });

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
