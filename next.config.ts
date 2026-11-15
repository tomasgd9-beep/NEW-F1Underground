import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite is only used for local development; keep it out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
