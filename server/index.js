import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import * as cheerio from 'cheerio';
import { unzipSync, strFromU8 } from 'fflate';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const app = express();

app.disable('x-powered-by');

// --- shared helpers ---
const UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 AutotekLookup/1.0';

function json(res, status, body) {
  res.status(status).setHeader('content-type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(body, null, 2));
}

function safeUrl(u) {
  try {
    const url = new URL(u);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizePlate(p) {
  if (!p) return null;
  const s = String(p).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length < 1 || s.length > 8) return null;
  return s;
}

function normalizeVin(v) {
  if (!v) return null;
  const s = String(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length !== 17) return null;
  return s;
}

async function fetchText(url, opts = {}) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': UA,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      ...(opts.headers || {})
    },
    ...(opts.fetch || {})
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  return await res.text();
}

async function fetchBuffer(url, opts = {}) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent': UA,
      accept: '*/*',
      ...(opts.headers || {})
    },
    ...(opts.fetch || {})
  });
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

function parseCsvLine(line) {
  // Minimal RFC4180-ish parser (handles quoted fields with commas + escaped quotes)
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur);
  return out;
}

// --- NZ Police stolen vehicle dataset cache ---
class PoliceStolenCache {
  constructor() {
    this.loadedAtMs = 0;
    this.records = new Map(); // key: plate (normalized) -> record
    this.vins = new Map(); // key: vin -> record
    this.lastSource = null;
  }

  async ensureFresh() {
    // Police says update 3x/day; cache for 2 hours.
    const maxAgeMs = 2 * 60 * 60 * 1000;
    if (Date.now() - this.loadedAtMs < maxAgeMs && this.records.size > 0) return;
    await this.refresh();
  }

  async refresh() {
    const pageUrl = 'https://www.police.govt.nz/can-you-help-us/stolen-vehicles';
    const pageHtml = await fetchText(pageUrl);
    const buildIdMatch = pageHtml.match(/name="form_build_id"[^>]*value="([^"]+)"/i);
    if (!buildIdMatch) throw new Error('Police page changed: missing form_build_id');
    const formBuildId = buildIdMatch[1];

    const formData = new URLSearchParams();
    formData.set('form_identifier', 'download_form');
    formData.set('form_build_id', formBuildId);
    formData.set('form_id', 'police_stolen_vehicles_download_form');
    formData.set('nz[all]', 'all');
    formData.set('download_submit', 'Download');

    const postRes = await fetch(pageUrl, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded' },
      body: formData.toString()
    });
    if (postRes.status !== 303) {
      const t = await postRes.text().catch(() => '');
      throw new Error(`Police download POST unexpected status ${postRes.status}: ${t.slice(0, 200)}`);
    }
    const location = postRes.headers.get('location');
    if (!location) throw new Error('Police download redirect missing location');

    const zipUrl = safeUrl(location) || new URL(location, pageUrl).toString();
    const zipBuf = await fetchBuffer(zipUrl);

    const files = unzipSync(new Uint8Array(zipBuf));
    const csvName = Object.keys(files).find((k) => k.toLowerCase().endsWith('.csv'));
    if (!csvName) throw new Error('Police ZIP did not contain a CSV');

    const csvText = strFromU8(files[csvName]);
    const lines = csvText.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) throw new Error('Police CSV empty');
    const header = parseCsvLine(lines[0]).map((h) => h.trim());
    const idx = Object.fromEntries(header.map((h, i) => [h.toLowerCase(), i]));

    const nextRecords = new Map();
    const nextVins = new Map();

    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      const plate = normalizePlate(cols[idx['registration']] || cols[idx['plate']] || cols[idx['rego']]);
      const vin = normalizeVin(cols[idx['vin']] || cols[idx['vehicle identification number']] || cols[idx['vehicle_id_number']]);
      const rec = {
        plate,
        vin,
        make: (cols[idx['make']] || '').trim() || null,
        model: (cols[idx['vehicle']] || cols[idx['model']] || '').trim() || null,
        colour: (cols[idx['colour']] || cols[idx['color']] || '').trim() || null,
        reported: (cols[idx['reported']] || cols[idx['date reported']] || '').trim() || null,
        district: (cols[idx['district']] || '').trim() || null
      };
      if (plate) nextRecords.set(plate, rec);
      if (vin) nextVins.set(vin, rec);
    }

    this.records = nextRecords;
    this.vins = nextVins;
    this.loadedAtMs = Date.now();
    this.lastSource = { pageUrl, zipUrl, csvName, rows: lines.length - 1 };
  }

  async lookup({ plate, vin }) {
    await this.ensureFresh();
    const p = normalizePlate(plate);
    const v = normalizeVin(vin);
    const match = (p && this.records.get(p)) || (v && this.vins.get(v)) || null;
    return {
      plate: p,
      vin: v,
      stolen: Boolean(match),
      match,
      source: {
        provider: 'nz_police_stolen_vehicles',
        cachedAt: new Date(this.loadedAtMs).toISOString(),
        ...(this.lastSource || {})
      }
    };
  }
}

const policeCache = new PoliceStolenCache();

// --- Pick A Part (Christchurch) ---
async function pickApartMakes(locationId = 7) {
  const url = locationId === 7
    ? 'https://www.pickapart.co.nz/Current-Stock-Christchurch'
    : `https://www.pickapart.co.nz/eziparts/Display_Makes.asp?LocationID=${encodeURIComponent(locationId)}&Location=pickapartconz`;
  const html = await fetchText(url);
  const $ = cheerio.load(html);
  const makes = [];

  $('a[href*="Display_Vehicles.asp"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const abs = href.startsWith('http') ? href : new URL(href, url).toString();
    const u = new URL(abs);
    const makeId = u.searchParams.get('MakeID');
    const loc = u.searchParams.get('LocationID');
    const desc = u.searchParams.get('VehicleDesc') || $(el).text();
    if (!makeId || !desc) return;
    if (String(loc || locationId) !== String(locationId)) return;
    makes.push({
      makeId: Number(makeId),
      make: String(desc).trim(),
      url: abs
    });
  });

  // De-dupe and sort
  const uniq = new Map();
  for (const m of makes) {
    if (!Number.isFinite(m.makeId)) continue;
    if (!uniq.has(m.makeId)) uniq.set(m.makeId, m);
  }
  return [...uniq.values()].sort((a, b) => a.make.localeCompare(b.make));
}

async function pickApartVehicles({ locationId = 7, makeId, pageNo = 1, keywords = '' }) {
  const url = `https://www.pickapart.co.nz/eziparts/Display_Vehicles.asp?LocationID=${encodeURIComponent(locationId)}&MakeID=${encodeURIComponent(makeId)}&PageNo=${encodeURIComponent(pageNo)}&SeriesID=0&txtKeywords=${encodeURIComponent(keywords)}`;
  const html = await fetchText(url);
  const $ = cheerio.load(html);

  const items = [];
  $('.car-detail-search').each((_, el) => {
    const root = $(el);
    const title = root.find('.car-search-name').first().text().trim() || null;
    const yard = root.find('.car-search-code').first().text().trim() || null;
    const viewHref = root.find('.car-search-view a').attr('href') || null;
    const viewUrl = viewHref
      ? (viewHref.startsWith('http') ? viewHref : new URL(viewHref, url).toString())
      : null;
    const vid = viewUrl ? Number(new URL(viewUrl).searchParams.get('VehicleID')) : null;
    const desc = viewUrl ? new URL(viewUrl).searchParams.get('VehicleDesc') : null;

    items.push({
      yard,
      title: title || desc || null,
      vehicleId: Number.isFinite(vid) ? vid : null,
      vehicleDesc: desc || null,
      viewUrl
    });
  });

  // Pagination hint
  const pageText = $('body').text();
  const pageMatch = pageText.match(/No\.\s*items\s*found:\s*(\d+)\s*\(Page\s*(\d+)\s*of\s*(\d+)\)/i);
  const meta = pageMatch
    ? { totalItems: Number(pageMatch[1]), page: Number(pageMatch[2]), totalPages: Number(pageMatch[3]) }
    : null;

  return { sourceUrl: url, meta, items };
}

// --- VIN decode (free) ---
async function decodeVin(vin) {
  const v = normalizeVin(vin);
  if (!v) return null;
  const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValuesExtended/${encodeURIComponent(v)}?format=json`;
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
  if (!res.ok) throw new Error(`VIN decode failed ${res.status}`);
  const data = await res.json();
  const row = data?.Results?.[0] || null;
  if (!row) return null;
  // Keep a compact subset
  const pick = (k) => (row[k] ? String(row[k]).trim() : null);
  return {
    vin: v,
    year: pick('ModelYear'),
    make: pick('Make'),
    model: pick('Model'),
    trim: pick('Trim'),
    bodyClass: pick('BodyClass'),
    engineCylinders: pick('EngineCylinders'),
    displacementL: pick('DisplacementL'),
    fuelTypePrimary: pick('FuelTypePrimary'),
    driveType: pick('DriveType'),
    transmissionStyle: pick('TransmissionStyle'),
    manufacturer: pick('Manufacturer'),
    plantCountry: pick('PlantCountry'),
    plantCity: pick('PlantCity'),
    sourceUrl: url
  };
}

// --- DuckDuckGo HTML search (free; best-effort) ---
async function ddgSearch(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const html = await fetchText(url);
  const $ = cheerio.load(html);
  const results = [];
  $('.result').each((_, el) => {
    const a = $(el).find('.result__a').first();
    const href = a.attr('href');
    const title = a.text().trim();
    const snippet = $(el).find('.result__snippet').first().text().trim();
    if (!href || !title) return;
    const u = safeUrl(href);
    if (!u) return;
    results.push({ title, url: u, snippet: snippet || null });
  });
  return { sourceUrl: url, results: results.slice(0, 8) };
}

// --- routes ---
app.get('/api/health', (_req, res) => {
  json(res, 200, { ok: true, name: 'autotek-lookup', now: new Date().toISOString() });
});

app.get('/api/police/stolen', async (req, res) => {
  const schema = z.object({
    plate: z.string().optional(),
    vin: z.string().optional()
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return json(res, 400, { error: 'invalid_query', issues: parsed.error.issues });
  try {
    const out = await policeCache.lookup(parsed.data);
    json(res, 200, out);
  } catch (e) {
    json(res, 502, { error: 'police_lookup_failed', message: String(e?.message || e) });
  }
});

app.get('/api/pickapart/makes', async (req, res) => {
  const schema = z.object({ locationId: z.coerce.number().int().min(1).max(99).optional() });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return json(res, 400, { error: 'invalid_query', issues: parsed.error.issues });
  try {
    const locationId = parsed.data.locationId ?? 7;
    const makes = await pickApartMakes(locationId);
    json(res, 200, { locationId, makes });
  } catch (e) {
    json(res, 502, { error: 'pickapart_makes_failed', message: String(e?.message || e) });
  }
});

app.get('/api/pickapart/vehicles', async (req, res) => {
  const schema = z.object({
    locationId: z.coerce.number().int().min(1).max(99).optional(),
    makeId: z.coerce.number().int().min(0).max(9999),
    pageNo: z.coerce.number().int().min(1).max(50).optional(),
    keywords: z.string().max(80).optional()
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return json(res, 400, { error: 'invalid_query', issues: parsed.error.issues });
  try {
    const out = await pickApartVehicles(parsed.data);
    json(res, 200, out);
  } catch (e) {
    json(res, 502, { error: 'pickapart_vehicles_failed', message: String(e?.message || e) });
  }
});

app.get('/api/vin/decode', async (req, res) => {
  const schema = z.object({ vin: z.string() });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return json(res, 400, { error: 'invalid_query', issues: parsed.error.issues });
  try {
    const out = await decodeVin(parsed.data.vin);
    if (!out) return json(res, 404, { error: 'vin_not_decoded' });
    json(res, 200, out);
  } catch (e) {
    json(res, 502, { error: 'vin_decode_failed', message: String(e?.message || e) });
  }
});

app.get('/api/faults/search', async (req, res) => {
  const schema = z.object({
    make: z.string().min(1).max(40),
    model: z.string().min(1).max(40),
    year: z.coerce.number().int().min(1970).max(2035).optional()
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return json(res, 400, { error: 'invalid_query', issues: parsed.error.issues });
  const { make, model, year } = parsed.data;
  try {
    const q = `${make} ${model}${year ? ` ${year}` : ''} common problems forum fix`;
    const out = await ddgSearch(q);
    json(res, 200, { query: q, ...out });
  } catch (e) {
    json(res, 502, { error: 'fault_search_failed', message: String(e?.message || e) });
  }
});

// --- static ---
app.use('/lookup', express.static(path.join(repoRoot, 'lookup'), { extensions: ['html'] }));
// Keep existing static marketing/report at root
app.use('/', express.static(repoRoot, { extensions: ['html'] }));

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`autotek lookup server listening on http://localhost:${port}`);
});

