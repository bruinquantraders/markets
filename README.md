# BQT Markets — Weighted Blotto

A strategy sandbox for Bruin Quant Traders. Players allocate **100 troops across 10
fields**; field **k** is worth **k points** (1 through 10). Every submitted strategy
plays every other one head-to-head (round-robin), and the leaderboard ranks by total
weighted points won.

Static site (HTML/CSS/JS) deployed on GitHub Pages at **markets.bruinquant.com**,
backed by **Supabase** (Postgres + REST API).

## Stack

- Vanilla HTML/CSS/JS, no build step. Dark black-and-white theme matching bruinquant.com.
- Supabase Postgres table `players` (`username`, `strategy` CSV, `updated_at`).

## Local preview

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

With `assets/js/config.js` missing or empty the site runs in **local mode** (localStorage +
built-in bot strategies). Copy `assets/js/config.example.js` → `config.js` and paste your
Supabase publishable key for the shared leaderboard.

## Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Copy `.env.local.example` → `.env.local` and fill in URL, publishable key, and secret key.
3. Apply the schema and migrate existing data:

```bash
npm install
npm run setup
```

`npm run setup` writes `assets/js/config.js` for the static site and imports any strategies
still on the old Google Sheet. If the `players` table does not exist yet, either:

- Add `SUPABASE_DB_PASSWORD` (Dashboard → **Settings → Database**) to `.env.local` and re-run `npm run setup`, or
- Paste `supabase/migrations/20250703000000_players.sql` into the Supabase **SQL editor** and run it, then `npm run setup` again.

### Table schema

| column     | type        | notes                                      |
|------------|-------------|--------------------------------------------|
| `username` | `text` PK   | 1–24 chars, one row per player             |
| `strategy` | `text`      | 10 comma-separated ints summing to 100     |
| `updated_at` | `timestamptz` | auto-updated on upsert                  |

Row Level Security allows public read/insert/update (username-only auth, same as the old sheet).

## Deployment (GitHub Pages)

Pushing to `main` triggers `.github/workflows/deploy.yml`. In the repo:
**Settings → Pages → Source = GitHub Actions**, and
**Settings → Actions → General → Workflow permissions = Read and write**.

Commit `assets/js/config.js` with your **publishable** key (safe for client-side use). Never commit `.env.local` or the secret key.

### Custom domain

`CNAME` is set to `markets.bruinquant.com`. Add a DNS record at your provider:

```
CNAME   markets   bruinquantraders.github.io
```

Set it to **DNS only** (grey cloud in Cloudflare) so GitHub can issue HTTPS.

## Scoring

For each pair of strategies, field **k** is worth **k points**. You win a field by placing
**strictly more** troops than your opponent (a tie splits the weight). Your **score** is
the sum of weighted points across all opponents (max **55** per matchup); **avg/55** is
per opponent; **W-L-D** is your match record (a match is won by outscoring your opponent).
