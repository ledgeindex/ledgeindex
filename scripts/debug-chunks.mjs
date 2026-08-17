/**
 * Count indexed chunks/URLs per source from the vector table.
 *
 *   node ledgeindex/scripts/debug-chunks.mjs [urlSubstring]
 */
import { loadScriptEnv } from "./load-env.mjs";

loadScriptEnv();

const needle = process.argv[2] ?? "";

const { createClient } = await import("@libsql/client");
const { join } = await import("node:path");

const dataDir = process.env.LEDGEINDEX_DATA_DIR;
console.log(`dataDir: ${dataDir}`);
const client = createClient({
  url: `file:${join(dataDir, "ledgeindex-vector.db")}`,
});

const cols = await client.execute("PRAGMA table_info(ledgeindex_chunks)");
console.log("chunk columns:", cols.rows.map((r) => r.name).join(", "));

const total = await client.execute(
  "SELECT COUNT(*) AS n FROM ledgeindex_chunks",
);
console.log(`total vector rows: ${total.rows[0].n}`);

const perSource = await client.execute(
  `SELECT json_extract(metadata,'$.sourceId') AS source_id,
          COUNT(*) AS chunks,
          COUNT(DISTINCT json_extract(metadata,'$.url')) AS urls
     FROM ledgeindex_chunks
    GROUP BY source_id
    ORDER BY chunks DESC`,
);
console.log("\nper source (vector table):");
for (const row of perSource.rows) {
  console.log(`  ${row.source_id}  chunks=${row.chunks}  urls=${row.urls}`);
}

if (needle) {
  const match = await client.execute({
    sql: `SELECT json_extract(metadata,'$.sourceId') AS source_id,
                 json_extract(metadata,'$.url') AS url,
                 COUNT(*) AS chunks
            FROM ledgeindex_chunks
           WHERE url LIKE '%' || ? || '%'
           GROUP BY source_id, url
           ORDER BY url
           LIMIT 40`,
    args: [needle],
  });
  console.log(`\nurls matching "${needle}": ${match.rows.length}`);
  for (const row of match.rows) {
    console.log(`  ${row.chunks}  ${row.url}  [${row.source_id}]`);
  }
}

process.exit(0);
