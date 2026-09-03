/* Bridge sync (see ASSET-BRIDGE.md):
   copies `approved` assets from assets/generated/approved/ into public/assets/
   unchanged, and publishes a trimmed manifest the game fetches at runtime.
   Run: node scripts/sync-assets.mjs   (also runs automatically before `npm run dev`) */
import { readFileSync, writeFileSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = join(root, "assets", "asset-manifest.json");
const approvedDir = join(root, "assets", "generated", "approved");
const outDir = join(root, "public", "assets");

mkdirSync(outDir, { recursive: true });

if (!existsSync(manifestPath)) {
  console.log("[sync] no manifest yet — nothing to do");
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const published = [];
let copied = 0, missing = 0, pending = 0;

for (const a of manifest.assets || []) {
  if (a.status !== "approved") { pending++; continue; }
  const src = join(approvedDir, a.file);
  if (!existsSync(src)) {
    console.warn(`[sync] MANIFEST says approved but file missing: ${a.id} (${a.file})`);
    missing++;
    continue;
  }
  copyFileSync(src, join(outDir, a.file));
  published.push(a);
  copied++;
}

writeFileSync(join(outDir, "manifest.json"), JSON.stringify({ ...manifest, assets: published }, null, 2));
console.log(`[sync] approved copied: ${copied} · pending: ${pending} · missing files: ${missing}`);
