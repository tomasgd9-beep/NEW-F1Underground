import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite is only used for local development; resvg is a native module. Keep both out of the bundle.
  serverExternalPackages: ["@electric-sql/pglite", "@resvg/resvg-js"],
  // Share images and the recap email (sent by the job, which any page visit can start) read the fonts at run time.
  outputFileTracingIncludes: {
    "/**": ["./assets/fonts/**"],
  },
};

export default nextConfig;
