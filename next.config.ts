import type { NextConfig } from "next";

// cacheComponents is deliberately off: every screen in Parchi shows live encounter data.
const nextConfig: NextConfig = {
  // NEXT_DIST_DIR lets a second, isolated build/test server run beside the serving one.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
