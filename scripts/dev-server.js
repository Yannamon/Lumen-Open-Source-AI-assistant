const path = require("node:path");

const { startServer } = require("next/dist/server/lib/start-server");
const loadConfig = require("next/dist/server/config").default;
const { PHASE_DEVELOPMENT_SERVER } = require("next/dist/shared/lib/constants");
const { setGlobal } = require("next/dist/trace/shared");

async function main() {
  const dir = process.cwd();
  const port = Number(process.env.PORT || 3000);
  const hostname = process.env.HOST || undefined;
  const config = await loadConfig(PHASE_DEVELOPMENT_SERVER, dir, {
    silent: false,
  });

  setGlobal("phase", PHASE_DEVELOPMENT_SERVER);
  setGlobal("distDir", path.join(dir, config.distDir || ".next"));

  await startServer({
    dir,
    port,
    allowRetry: !process.env.PORT,
    isDev: true,
    hostname,
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
