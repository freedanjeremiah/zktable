// Copies the compiled move_along ACIR artifact into public/ so the browser
// prover (M8.5) can fetch it. The artifact is a gitignored build product —
// error loudly (with the fix) rather than shipping a page that 404s.
import { copyFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../../circuits/move_along/target/move_along.json");
const destDir = path.resolve(here, "../public/circuits");
const dest = path.join(destDir, "move_along.json");

try {
  await access(src);
} catch {
  console.error(
    `[copy-circuit-assets] missing ${src}\n` +
      "Build it first: packages/circuits/scripts/build_all.sh move_along (or just `nargo compile` in that circuit dir).",
  );
  process.exit(1);
}
await mkdir(destDir, { recursive: true });
await copyFile(src, dest);
console.log(`[copy-circuit-assets] ${path.basename(src)} -> public/circuits/`);
