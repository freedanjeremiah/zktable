import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // This package lives inside the zktable pnpm monorepo; pin the workspace
  // root explicitly so Next doesn't warn about (or mis-infer) lockfile scope.
  outputFileTracingRoot: path.resolve(dirname, "../.."),
};

export default nextConfig;
