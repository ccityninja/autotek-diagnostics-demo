# Autotek Diagnostics — static host (Ship)

**DEMO only.** Static marketing homepage + sample report. Brand does **not** deploy.
This folder is what Ship serves.

## Layout

- `index.html` — marketing homepage (v1.1d locked copy)
- `assets/marketing.css` — dark-glass marketing styles (tokens match report app)
- `report/` — sample report (KQM299). **Do not delete.** Owned by Report UI.
- `lookup/` — developer-only lookup tool UI (requires backend proxy)
- `server/` — small Node server (serves static + API proxies for free/public sources)

## Preview locally

From this directory:

```bash
cd /workspace/autotek-static
python3 -m http.server 8080
```

Open http://localhost:8080/

- Homepage: `/`
- Sample report: `/report/` (or click **See sample report (KQM299)**)

## Lookup tool (dev)

The `/lookup/` tool is **not** wired into marketing CTAs and does **not** bypass NZTA CAPTCHAs or restricted Motor Vehicle Register data.
It only uses sources that are free/public (eg NZ Police stolen vehicle dataset, Pick A Part yard stock, VIN decode, best-effort fault link discovery).

Run:

```bash
cd /workspace
npm install
npm run dev
```

Open:

- Lookup tool: `http://localhost:3000/lookup/`
- Marketing: `http://localhost:3000/`
- Sample report UI: `http://localhost:3000/report/`

## CTAs (locked)

- **Primary demo:** See sample report (KQM299) → `report/` (no live plate pull)
- **Paid:** Get a report — $9.95 → `#pricing` (no fake checkout on DEMO)
- PPSR / money owing **not included** — verify separately (loud footnote)

## Kill-rules held

- No free plate check / free preview bait
- No PPSR clear / money owing in the $9.95 offer
- No Motochek/PPSR bundled
- No invented live dates as real (example dates labelled DEMO)
- Plate field demo-only (disabled / preventDefault)

## Source of truth

Brand draft + mirror: `/workspace/autotek-marketing/`  
Report app source: `/workspace/autotek-report/` (copied into `report/` for Ship)
