/**
 * Regenerates `src/icdf/manifest.ts` from the tables the registry currently produces.
 *
 * Run deliberately, never automatically:
 *
 *     npx tsx packages/sim/tools/gen-icdf-manifest.ts
 *
 * Regenerating is an explicit statement that a table change is INTENDED. If the manifest
 * were refreshed automatically, the drift check would rubber-stamp exactly the silent
 * change it exists to catch. A regenerated manifest means every previously recorded state
 * hash is no longer comparable — so bump ENGINE_VERSION in the same commit.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ICDFRegistry } from '../src/icdf/registry.js';

const registry = new ICDFRegistry();
const manifest = registry.getManifest();

const body = `/**
 * ICDF table checksums — GENERATED. Do not edit by hand.
 * Regenerate with: npx tsx packages/sim/tools/gen-icdf-manifest.ts
 *
 * Exists as a .ts module rather than a .json file so it needs no resolveJsonModule, no
 * copy step into dist/, and no filesystem read at runtime.
 */
export interface ICDFManifestEntry {
  readonly hash: string;
  readonly params: Record<string, number>;
}

export const ICDF_MANIFEST: Readonly<Record<string, ICDFManifestEntry>> = ${JSON.stringify(
  manifest,
  null,
  2
)} as const;
`;

const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'icdf', 'manifest.ts');
writeFileSync(outPath, body, 'utf8');

console.log(`Wrote ${Object.keys(manifest).length} table checksums to ${outPath}`);
for (const [key, entry] of Object.entries(manifest)) {
  console.log(`  ${key.padEnd(20)} ${entry.hash.slice(0, 16)}…`);
}
