import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // This package lives inside the zktable pnpm monorepo; pin the workspace
  // root explicitly so Next doesn't warn about (or mis-infer) lockfile scope.
  outputFileTracingRoot: path.resolve(dirname, "../.."),
  // The M4b Blackout API routes pull in workspace packages
  // (@zktable/blackout, @zktable/circuits, @zktable/core, @zktable/agents)
  // whose source uses NodeNext-style internal imports (`./foo.js`) that
  // actually resolve to `./foo.ts` — standard for this monorepo's
  // "moduleResolution": "bundler" setup (tsc/vitest/tsx all handle it).
  // Turbopack's `resolveExtensions` only kicks in for EXTENSIONLESS
  // specifiers, not for a specifier that already ends in `.js` resolving to
  // a same-named `.ts` file, so it can't fix this; the `dev`/`build`
  // scripts pass `--webpack` to opt out of Turbopack, and this
  // `resolve.extensionAlias` does exactly what's needed.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
