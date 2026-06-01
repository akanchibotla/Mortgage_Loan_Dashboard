// Split us-atlas counties-10m.json into per-state GeoJSON files so the county
// choropleth only ships the geometry for the state being viewed.
//
// Reads node_modules/us-atlas/counties-10m.json (3,231 counties, ~700KB).
// Emits src/data/topo/{state-fips}.json (FeatureCollection-shaped, ~5-150KB
// per state depending on county count).
//
// Run: node scripts/build_state_topo.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { feature, mesh } from 'topojson-client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const topoPath = path.join(REPO_ROOT, 'node_modules', 'us-atlas', 'counties-10m.json');
const outDir = path.join(REPO_ROOT, 'src', 'data', 'topo');

const topo = JSON.parse(fs.readFileSync(topoPath, 'utf-8'));
const allCounties = feature(topo, topo.objects.counties);
const allStates = feature(topo, topo.objects.states);

// Group counties by 2-digit state FIPS prefix.
const byState = new Map();
for (const f of allCounties.features) {
  const fips = String(f.id).padStart(5, '0');
  const stateFips = fips.slice(0, 2);
  if (!byState.has(stateFips)) byState.set(stateFips, []);
  byState.get(stateFips).push(f);
}

const stateByFips = new Map();
for (const f of allStates.features) {
  stateByFips.set(String(f.id).padStart(2, '0'), f);
}

fs.mkdirSync(outDir, { recursive: true });
let total = 0;
for (const [stateFips, features] of [...byState.entries()].sort()) {
  const stateFeature = stateByFips.get(stateFips) ?? null;
  // Mesh the state outline so we render an internal border for clarity. Cheap.
  const out = {
    state_fips: stateFips,
    n_counties: features.length,
    counties: { type: 'FeatureCollection', features },
    state: stateFeature,
  };
  const outPath = path.join(outDir, `${stateFips}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out));
  const size = fs.statSync(outPath).size;
  total += size;
  console.log(`  ${stateFips}: ${features.length} counties, ${(size / 1024).toFixed(1)} KB`);
}
console.log(`\nWrote ${byState.size} per-state files, ${(total / 1024).toFixed(1)} KB total -> ${outDir}`);
