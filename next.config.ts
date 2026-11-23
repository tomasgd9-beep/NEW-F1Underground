import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite is only used for local development; resvg is a native module. Keep both out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite", "@resvg/resvg-js"],
  // The share images and the recap email read the font files at run time.
  outputFileTracingIncludes: {
    "/api/share/**": ["./assets/fonts/**"],
    "/admin": ["./assets/fonts/**"],
  },
};

export default nextConfig;
