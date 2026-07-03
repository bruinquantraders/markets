# BQT Markets — Colonel Blotto

A strategy sandbox for Bruin Quant Traders. Players allocate **100 troops across 10
fields**; every submitted strategy plays every other one head-to-head (round-robin),
and the leaderboard ranks by total field points won.

Static site (HTML/CSS/JS) deployed on GitHub Pages at **markets.bruinquant.com**,
backed by a Google Sheet through a small Apps Script web app.

## Stack

- Vanilla HTML/CSS/JS, no build step. Dark black-and-white theme matching bruinquant.com.
- Google Apps Script + Google Sheet as the datastore.

## Local preview

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

With `CONFIG.APPS_SCRIPT_URL` empty the site runs in **local mode** (localStorage +
built-in bot strategies) so you can play immediately. Set the URL for the shared board.

## Backend setup (Google Apps Script)

1. Open the Sheet → **Extensions → Apps Script**.
2. Replace `Code.gs` with [`backend/Code.gs`](backend/Code.gs). Save.
3. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Copy the `/exec` URL and paste it into `assets/js/blotto.js` → `CONFIG.APPS_SCRIPT_URL`.
5. Commit & push. The nav badge flips from `local` to `live`.

Re-deploy a **new version** in Apps Script whenever `Code.gs` changes.

### Sheet schema

Row 1 headers: `username | hash`. The `hash` column stores the strategy as a
comma-separated string of 10 integers summing to 100
(e.g. `10,10,10,10,10,10,10,10,10,10`). One row per username; resubmitting updates it.

## Deployment (GitHub Pages)

Pushing to `main` triggers `.github/workflows/deploy.yml`. In the repo:
**Settings → Pages → Source = GitHub Actions**, and
**Settings → Actions → General → Workflow permissions = Read and write**.

### Custom domain

`CNAME` is set to `markets.bruinquant.com`. Add a DNS record at your provider:

```
CNAME   markets   bruinquantraders.github.io
```

Set it to **DNS only** (grey cloud in Cloudflare) so GitHub can issue HTTPS.

## Scoring

For each pair of strategies, you win a field by placing **strictly more** troops than
your opponent (a tie splits the field, 0.5 each). Your **score** is the sum of field
points across all opponents; **avg/10** is per opponent; **W-L-D** is your match record
(a match is won by taking more than half the fields).
