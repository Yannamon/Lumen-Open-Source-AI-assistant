/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.LUMEN_NEXT_DIST_DIR || ".next",
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Permissions-Policy",
            value: "microphone=(self), camera=(self)",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
