import type { NextConfig } from "next";

// One .env for the whole repo (CLAUDE.md): the services load it with --env-file, and Next only looks inside app/,
// so the root file is loaded here. Missing is fine — CI and deploys set real environment variables.
try {
  process.loadEnvFile(new URL("../.env", import.meta.url));
} catch {
  // no .env on this machine
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@mandate/common", "underwriter"],
  serverExternalPackages: [],
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
