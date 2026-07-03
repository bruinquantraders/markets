/**
 * One-time setup: apply schema (needs SUPABASE_DB_PASSWORD) and migrate
 * existing Google Sheet data into Supabase.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function loadEnv() {
  const path = join(root, ".env.local");
  if (!existsSync(path)) throw new Error("Missing .env.local");
  const env = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const publishable = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY;
const secret = env.SUPABASE_SECRET_KEY || env.SUPABSE_SECRET_KEY;
const dbPassword = env.SUPABASE_DB_PASSWORD;

if (!url || !secret) {
  throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local");
}

const projectRef = new URL(url).hostname.split(".")[0];
const migrationSql = readFileSync(
  join(root, "supabase/migrations/20250703000000_players.sql"),
  "utf8"
);

/** New sb_secret_* keys must be sent on apikey only (not Authorization Bearer). */
function adminClient() {
  return createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { apikey: secret },
      fetch: (input, init = {}) => {
        const headers = new Headers(init.headers || {});
        headers.set("apikey", secret);
        headers.delete("authorization");
        return fetch(input, { ...init, headers });
      },
    },
  });
}

async function applySchemaViaPg() {
  if (env.SUPABASE_DB_URL) {
    const client = new pg.Client({
      connectionString: env.SUPABASE_DB_URL,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    try {
      await client.query(migrationSql);
      console.log("Schema applied via SUPABASE_DB_URL.");
      return true;
    } finally {
      await client.end();
    }
  }

  if (!dbPassword) return false;

  const regions = ["us-east-1", "us-west-1", "us-west-2", "eu-west-1", "eu-central-1", "ap-southeast-1"];
  const hosts = [
    { host: `db.${projectRef}.supabase.co`, port: 5432, user: "postgres" },
    ...regions.flatMap((region) => [
      { host: `aws-0-${region}.pooler.supabase.com`, port: 5432, user: `postgres.${projectRef}` },
      { host: `aws-0-${region}.pooler.supabase.com`, port: 6543, user: `postgres.${projectRef}` },
    ]),
  ];

  let lastErr = null;
  for (const target of hosts) {
    const client = new pg.Client({
      ...target,
      password: dbPassword,
      database: "postgres",
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    });
    try {
      await client.connect();
      await client.query(migrationSql);
      await client.end();
      console.log(`Schema applied via Postgres (${target.user}@${target.host}:${target.port}).`);
      return true;
    } catch (err) {
      lastErr = err;
      try { await client.end(); } catch { /* ignore */ }
    }
  }

  if (lastErr) {
    console.error(`Could not apply schema via Postgres: ${lastErr.message}`);
    console.error("Verify SUPABASE_DB_PASSWORD (Dashboard → Settings → Database), or run the SQL file manually.");
  }
  return false;
}

async function applySchemaViaCli() {
  const token = env.SUPABASE_ACCESS_TOKEN;
  if (!token || !dbPassword) return false;

  const { spawnSync } = await import("node:child_process");
  process.env.SUPABASE_ACCESS_TOKEN = token;
  const link = spawnSync(
    "npx",
    ["supabase", "link", "--project-ref", projectRef, "--password", dbPassword],
    { cwd: root, stdio: "inherit", env: process.env }
  );
  if (link.status !== 0) return false;

  const push = spawnSync("npx", ["supabase", "db", "push"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (push.status === 0) {
    console.log("Schema applied via supabase db push.");
    return true;
  }
  return false;
}

async function applySchema() {
  if (await applySchemaViaPg()) return true;
  if (await applySchemaViaCli()) return true;

  if (!dbPassword) {
    console.log("SUPABASE_DB_PASSWORD not set — skipping DDL.");
    console.log("Add SUPABASE_DB_PASSWORD (Dashboard → Settings → Database) to .env.local,");
    console.log("or paste supabase/migrations/20250703000000_players.sql into the SQL editor.");
  }
  return false;
}

async function tableReady(supabase) {
  const { error } = await supabase.from("players").select("username").limit(1);
  return !error || error.code !== "PGRST205";
}

const SHEET_URL =
  "https://script.google.com/macros/s/AKfycbyYzG1IdB6PAGm6H_3o_XxO1zh8vcnT4iTG_dsGLDU86G_map5yWe4svV9dqNztNjMdeA/exec";

function toCsv(strategy) {
  return strategy.join(",");
}

async function migrateFromSheet(supabase) {
  const res = await fetch(SHEET_URL, { redirect: "follow" });
  if (!res.ok) throw new Error(`Sheet fetch failed (${res.status})`);
  const data = await res.json();
  const players = (data.players || []).filter((p) => p?.username && Array.isArray(p.strategy));
  if (!players.length) {
    console.log("No players to migrate from Google Sheet.");
    return;
  }

  const rows = players.map((p) => ({
    username: String(p.username).trim(),
    strategy: toCsv(p.strategy),
  }));

  const { error } = await supabase.from("players").upsert(rows, { onConflict: "username" });
  if (error) throw new Error(`migrate failed: ${error.message}`);
  console.log(`Migrated ${rows.length} players from Google Sheet → Supabase.`);
}

async function main() {
  const supabase = adminClient();

  if (!(await tableReady(supabase))) {
    const applied = await applySchema();
    if (!applied || !(await tableReady(supabase))) {
      throw new Error("players table missing — apply migration SQL first, then re-run npm run setup");
    }
  } else {
    console.log("players table exists.");
  }

  await migrateFromSheet(supabase);

  if (publishable) {
    const cfg = `window.SUPABASE_CONFIG = {\n  url: ${JSON.stringify(url)},\n  key: ${JSON.stringify(publishable)},\n};\n`;
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(root, "assets/js/config.js"), cfg);
    console.log("Wrote assets/js/config.js");
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
