/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.LUMEN_NEXT_DIST_DIR || ".next",
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
