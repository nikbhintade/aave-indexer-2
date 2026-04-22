/**
 * Data accuracy comparison: local graph-node subgraph vs HyperIndex
 *
 * Prerequisites:
 *   1. graph-node running locally (docker compose up in protocol-subgraphs/)
 *   2. Subgraph deployed: "aave-v3" at http://localhost:8000/subgraphs/name/aave-v3
 *   3. ENVIO_API_TOKEN set in .env
 *
 * Run: pnpm tsx scripts/compare.ts
 */

import { createTestIndexer } from "../generated";

const SUBGRAPH_URL = "http://localhost:8000/subgraphs/name/aave-v3";
const START_BLOCK  = 16291006;
// Initial 7 reserves: blocks 16496783-16496810
// Additional 4 (LUSD/rETH/cbETH/USDT): blocks 16575788-16707634
// CRV added at block 16784190
const END_BLOCK    = 16800000;
const CHAIN_ID     = 1;

async function querySubgraph(query: string): Promise<Record<string, unknown[]>> {
  const res = await fetch(SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Subgraph request failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as { data?: Record<string, unknown[]>; errors?: unknown[] };
  if (json.errors?.length) throw new Error(`Subgraph errors: ${JSON.stringify(json.errors)}`);
  return json.data ?? {};
}

function header(title: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(title);
  console.log("=".repeat(60));
}

function status(ok: boolean, label: string) {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
}

async function main() {
  header(`Comparing blocks ${START_BLOCK}–${END_BLOCK} on chain ${CHAIN_ID}`);

  // ── HyperIndex ─────────────────────────────────────────────────────────────
  console.log("\n[1/2] Running HyperIndex (HyperSync)...");
  const indexer = createTestIndexer();
  await indexer.process({
    chains: { [CHAIN_ID]: { startBlock: START_BLOCK, endBlock: END_BLOCK } },
  });

  const [hiPools, hiReserves, hiSubTokens] = await Promise.all([
    indexer.Pool.getAll(),
    indexer.Reserve.getAll(),
    indexer.SubToken.getAll(),
  ]);

  console.log(`   Pools:     ${hiPools.length}`);
  console.log(`   Reserves:  ${hiReserves.length}`);
  console.log(`   SubTokens: ${hiSubTokens.length}`);

  // ── Subgraph ────────────────────────────────────────────────────────────────
  console.log("\n[2/2] Querying subgraph (local graph-node)...");
  const sgData = await querySubgraph(`{
    pools(first: 100) { id }
    reserves(first: 100) { id underlyingAsset symbol name }
  }`);

  type SgPool    = { id: string };
  type SgReserve = { id: string; underlyingAsset: string; symbol: string; name: string };
  const sgPools    = (sgData.pools    ?? []) as SgPool[];
  const sgReserves = (sgData.reserves ?? []) as SgReserve[];

  console.log(`   Pools:     ${sgPools.length}`);
  console.log(`   Reserves:  ${sgReserves.length}`);

  // ── Comparison ──────────────────────────────────────────────────────────────
  header("Results");

  // Pool count
  status(hiPools.length === sgPools.length,
    `Pool count: HyperIndex=${hiPools.length}, Subgraph=${sgPools.length}`);

  // Reserve count
  status(hiReserves.length === sgReserves.length,
    `Reserve count: HyperIndex=${hiReserves.length}, Subgraph=${sgReserves.length}`);

  // SubToken count (3 per reserve)
  const expectedSubTokens = sgReserves.length * 3;
  status(hiSubTokens.length === expectedSubTokens,
    `SubToken count: HyperIndex=${hiSubTokens.length}, expected=${expectedSubTokens} (3×${sgReserves.length})`);

  // Reserve underlyingAsset set comparison
  const hiAssets = new Set(hiReserves.map((r) => r.underlyingAsset.toLowerCase()));
  const sgAssets = new Set(sgReserves.map((r) => r.underlyingAsset.toLowerCase()));

  const missingInHI  = [...sgAssets].filter((a) => !hiAssets.has(a));
  const extraInHI    = [...hiAssets].filter((a) => !sgAssets.has(a));

  status(missingInHI.length === 0 && extraInHI.length === 0, "Reserve assets match");

  if (missingInHI.length) {
    console.log("  Missing in HyperIndex:", missingInHI);
  }
  if (extraInHI.length) {
    console.log("  Extra in HyperIndex:  ", extraInHI);
  }

  // Per-reserve spot-check (name/symbol via RPC — TODO in HyperIndex, will differ)
  console.log("\nReserve details (subgraph vs HyperIndex):");
  for (const r of sgReserves.slice(0, 15)) {
    const hiMatch = hiReserves.find(
      (h) => h.underlyingAsset.toLowerCase() === r.underlyingAsset.toLowerCase()
    );
    console.log(
      `  ${r.symbol.padEnd(8)} ${r.underlyingAsset}  ${hiMatch ? "found" : "[MISSING in HyperIndex]"}`
    );
  }

  const allOk = hiPools.length === sgPools.length &&
                hiReserves.length === sgReserves.length &&
                missingInHI.length === 0 &&
                extraInHI.length === 0;

  console.log(`\n${allOk ? "All checks passed!" : "Some checks failed — see above."}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
