/* global fetch */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const elPlate = $('plate');
  const elVin = $('vin');
  const btnLookup = $('btn-lookup');

  const results = $('results');
  const policeOut = $('police-out');
  const policeBadge = $('police-badge');

  const elMake = $('make');
  const elModel = $('model');
  const elYear = $('year');
  const identityBadge = $('identity-badge');

  const selPickApartMake = $('pickapart-make');
  const btnPickApart = $('btn-pickapart');
  const pickApartOut = $('pickapart-out');

  const btnFaults = $('btn-faults');
  const faultsOut = $('faults-out');

  const techOut = $('tech-out');
  const techBadge = $('tech-badge');

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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

  function setBusy(busy) {
    btnLookup.disabled = busy;
    btnPickApart.disabled = busy;
    btnFaults.disabled = busy;
  }

  async function getJson(url) {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}
    if (!res.ok) {
      const msg = (data && data.message) ? data.message : text.slice(0, 200);
      throw new Error(msg || ('HTTP ' + res.status));
    }
    return data;
  }

  function renderPolice(out) {
    if (!out) return;
    if (out.stolen) {
      policeBadge.className = 'badge badge-bad';
      policeBadge.textContent = 'HIT';
    } else {
      policeBadge.className = 'badge badge-live';
      policeBadge.textContent = 'No hit';
    }

    const src = out.source || {};
    const match = out.match;
    const lines = [];
    lines.push(`plate: ${out.plate || '—'}`);
    if (out.vin) lines.push(`vin: ${out.vin}`);
    lines.push(`stolen: ${out.stolen ? 'YES (reported stolen)' : 'NO HIT in last 6 months dataset'}`);
    if (match) {
      lines.push('');
      lines.push('match:');
      lines.push(`  make: ${match.make || '—'}`);
      lines.push(`  model: ${match.model || '—'}`);
      lines.push(`  colour: ${match.colour || '—'}`);
      lines.push(`  reported: ${match.reported || '—'}`);
      lines.push(`  district: ${match.district || '—'}`);
    }
    lines.push('');
    lines.push(`source: NZ Police stolen vehicles dataset (snapshot)`);
    if (src.cachedAt) lines.push(`cached at: ${src.cachedAt}`);
    policeOut.textContent = lines.join('\n');
  }

  function setIdentityFromVin(v) {
    const changed = [];
    if (v?.make && !elMake.value) { elMake.value = v.make; changed.push('make'); }
    if (v?.model && !elModel.value) { elModel.value = v.model; changed.push('model'); }
    if (v?.year && !elYear.value) { elYear.value = v.year; changed.push('year'); }
    if (changed.length) {
      identityBadge.className = 'badge badge-neutral';
      identityBadge.textContent = 'From VIN';
    }
  }

  function renderTechPack(state) {
    const plate = state.plate || null;
    const vin = state.vinDecode || null;
    const make = (state.make || '').trim();
    const model = (state.model || '').trim();
    const year = Number(state.year || 0) || null;

    const lines = [];
    lines.push('<p><strong>Variant gate:</strong> to be precise about ECU type / key / fluids you must confirm engine + gearbox (VIN decode helps, but may still be incomplete for JDM/NZ variants).</p>');

    if (vin) {
      techBadge.className = 'badge badge-live';
      techBadge.textContent = 'VIN decoded';
      lines.push('<div class="item">');
      lines.push(`<div class="title">VIN decode (free NHTSA vPIC)</div>`);
      lines.push('<div class="meta mono">');
      lines.push(`vin: ${esc(vin.vin)}<br/>`);
      lines.push(`year: ${esc(vin.year || '—')} · make: ${esc(vin.make || '—')} · model: ${esc(vin.model || '—')} · trim: ${esc(vin.trim || '—')}<br/>`);
      lines.push(`engine: ${esc(vin.engineCylinders || '—')} cyl · ${esc(vin.displacementL || '—')} L · fuel: ${esc(vin.fuelTypePrimary || '—')}<br/>`);
      lines.push(`drive: ${esc(vin.driveType || '—')} · trans: ${esc(vin.transmissionStyle || '—')}`);
      lines.push('</div></div>');
    } else {
      techBadge.className = 'badge badge-neutral';
      techBadge.textContent = 'Variant-gated';
    }

    const y = vin?.year ? Number(vin.year) : year;
    if (y) {
      const likelyNet = y >= 2008 ? 'CAN (OBD-II over CAN is common)' : 'ISO9141/KWP2000 or early CAN (varies by make/model)';
      lines.push('<div class="item">');
      lines.push('<div class="title">In-car network (best-effort)</div>');
      lines.push(`<div class="meta">Year: <strong>${esc(String(y))}</strong> → likely: <strong>${esc(likelyNet)}</strong>. Confirm with a scan tool: it will show protocol (CAN / ISO / KWP).</div>`);
      lines.push('</div>');
    }

    lines.push('<div class="item">');
    lines.push('<div class="title">Key / immobiliser (how to confirm fast)</div>');
    lines.push('<div class="meta">');
    lines.push('Look at the key head and remote: note if it’s a <strong>blade key</strong>, <strong>flip key</strong>, or <strong>smart key (push-start)</strong>. Read the remote’s <strong>FCC ID / IC / frequency</strong> (often 315/433/868MHz). For transponder keys, a locksmith can read chip type in minutes.');
    lines.push('</div></div>');

    lines.push('<div class="item">');
    lines.push('<div class="title">ECU / modules (what we can reliably infer)</div>');
    lines.push('<div class="meta">');
    lines.push('ECU supplier (Bosch/Denso/Delphi/etc) and module topology are <strong>trim/market dependent</strong>. Use VIN decode + a scan tool “module list” to identify: ECM, TCM, ABS, SRS, BCM, EPS, immobiliser, etc. If you paste the module list here later, we can map it to known failure points.');
    lines.push('</div></div>');

    lines.push('<div class="item">');
    lines.push('<div class="title">Oil & fluids (safe guidance)</div>');
    lines.push('<div class="meta">');
    lines.push('Without confirmed engine code, we will not guess a viscosity/spec. Best method: check the under-bonnet sticker or handbook for <strong>viscosity + OEM approval</strong> (e.g. VW 502.00 / Toyota 0W-20). If you provide engine code (or VIN decode yields it), we’ll populate a precise spec and typical service intervals.');
    lines.push('</div></div>');

    if (plate) {
      lines.push('<div class="item">');
      lines.push('<div class="title">NZTA checks (manual)</div>');
      lines.push('<div class="meta">');
      lines.push('For WOF/rego/RUC expiry, use the official NZTA “Check expiry” page (CAPTCHA) and compare the windscreen labels. This tool won’t bypass CAPTCHA.');
      lines.push('</div></div>');
    }

    if (make && model) {
      lines.push('<div class="item">');
      lines.push('<div class="title">Quick buyer checks (based on make/model)</div>');
      lines.push('<div class="meta">');
      lines.push(`If you’re inspecting a <strong>${esc(make)} ${esc(model)}</strong>, do: cold start, full warm-up drive, scan for pending codes, check coolant/oil contamination, gearbox shift quality, and confirm timing chain/belt history if applicable.`);
      lines.push('</div></div>');
    }

    techOut.innerHTML = lines.join('\n');
  }

  async function loadPickApartMakes() {
    const data = await getJson('/api/pickapart/makes?locationId=7');
    const makes = data.makes || [];
    selPickApartMake.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = 'Select make…';
    selPickApartMake.appendChild(opt0);
    makes.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = String(m.makeId);
      opt.textContent = `${m.make} (MakeID ${m.makeId})`;
      selPickApartMake.appendChild(opt);
    });
  }

  function renderPickApartVehicles(out) {
    pickApartOut.innerHTML = '';
    const items = out.items || [];
    if (!items.length) {
      pickApartOut.innerHTML = '<div class="item"><div class="title">No vehicles found</div><div class="meta">Try another make or check Pick A Part directly.</div></div>';
      return;
    }
    if (out.meta && out.meta.totalItems != null) {
      const meta = document.createElement('div');
      meta.className = 'item';
      meta.innerHTML = `<div class="title">Found ${esc(String(out.meta.totalItems))} vehicles (page ${esc(String(out.meta.page))}/${esc(String(out.meta.totalPages))})</div>` +
        `<div class="meta">Source: <a href="${esc(out.sourceUrl)}" target="_blank" rel="noreferrer">Pick A Part EziParts</a></div>`;
      pickApartOut.appendChild(meta);
    }
    items.slice(0, 50).forEach((v) => {
      const div = document.createElement('div');
      div.className = 'item';
      const title = v.title || v.vehicleDesc || 'Vehicle';
      const meta = [
        v.yard ? `Yard: ${v.yard}` : null,
        v.vehicleId ? `VehicleID: ${v.vehicleId}` : null
      ].filter(Boolean).join(' · ');
      div.innerHTML =
        `<div class="title">${esc(title)}</div>` +
        `<div class="meta">${esc(meta)}${v.viewUrl ? ` · <a href="${esc(v.viewUrl)}" target="_blank" rel="noreferrer">View details</a>` : ''}</div>`;
      pickApartOut.appendChild(div);
    });
  }

  function renderFaults(out) {
    faultsOut.innerHTML = '';
    const results = out.results || [];
    if (!results.length) {
      faultsOut.innerHTML = '<div class="item"><div class="title">No results</div><div class="meta">Try adding engine/gearbox keywords (e.g. “DSG”, “CVT”, “2.0 TDI”).</div></div>';
      return;
    }
    const meta = document.createElement('div');
    meta.className = 'item';
    meta.innerHTML = `<div class="title">Query</div><div class="meta mono">${esc(out.query || '')}</div>`;
    faultsOut.appendChild(meta);

    results.forEach((r) => {
      const div = document.createElement('div');
      div.className = 'item';
      div.innerHTML =
        `<div class="title"><a href="${esc(r.url)}" target="_blank" rel="noreferrer">${esc(r.title)}</a></div>` +
        (r.snippet ? `<div class="meta">${esc(r.snippet)}</div>` : `<div class="meta">—</div>`);
      faultsOut.appendChild(div);
    });
  }

  async function onLookup() {
    const plate = normalizePlate(elPlate.value);
    const vin = normalizeVin(elVin.value);
    if (!plate && !vin) {
      alert('Enter a plate or a 17-char VIN.');
      return;
    }
    results.hidden = false;
    setBusy(true);
    policeOut.textContent = 'Loading…';
    pickApartOut.innerHTML = '';
    faultsOut.innerHTML = '';
    try {
      // 1) Police stolen lookup
      const qs = new URLSearchParams();
      if (plate) qs.set('plate', plate);
      if (vin) qs.set('vin', vin);
      const police = await getJson('/api/police/stolen?' + qs.toString());
      renderPolice(police);

      // 2) VIN decode (optional)
      let vinDecoded = null;
      if (vin) {
        try {
          vinDecoded = await getJson('/api/vin/decode?vin=' + encodeURIComponent(vin));
          setIdentityFromVin(vinDecoded);
        } catch (_) {
          // Non-fatal
        }
      }

      // 3) Ensure Pick A Part makes are loaded once
      if (!selPickApartMake.options.length) {
        await loadPickApartMakes();
      }

      const state = {
        plate,
        vinDecode: vinDecoded,
        make: elMake.value,
        model: elModel.value,
        year: elYear.value
      };
      renderTechPack(state);
    } catch (e) {
      policeOut.textContent = String(e?.message || e);
    } finally {
      setBusy(false);
    }
  }

  async function onPickApart() {
    const makeId = selPickApartMake.value ? Number(selPickApartMake.value) : null;
    if (!makeId) {
      alert('Select a make first.');
      return;
    }
    setBusy(true);
    pickApartOut.innerHTML = '<div class="item"><div class="title">Loading…</div></div>';
    try {
      const out = await getJson(`/api/pickapart/vehicles?locationId=7&makeId=${encodeURIComponent(String(makeId))}&pageNo=1`);
      renderPickApartVehicles(out);
    } catch (e) {
      pickApartOut.innerHTML = `<div class="item"><div class="title">Failed</div><div class="meta">${esc(String(e?.message || e))}</div></div>`;
    } finally {
      setBusy(false);
    }
  }

  async function onFaults() {
    const make = (elMake.value || '').trim();
    const model = (elModel.value || '').trim();
    const year = (elYear.value || '').trim();
    if (!make || !model) {
      alert('Enter make and model first (or use VIN).');
      return;
    }
    setBusy(true);
    faultsOut.innerHTML = '<div class="item"><div class="title">Searching…</div></div>';
    try {
      const qs = new URLSearchParams();
      qs.set('make', make);
      qs.set('model', model);
      if (year) qs.set('year', year);
      const out = await getJson('/api/faults/search?' + qs.toString());
      renderFaults(out);
    } catch (e) {
      faultsOut.innerHTML = `<div class="item"><div class="title">Failed</div><div class="meta">${esc(String(e?.message || e))}</div></div>`;
    } finally {
      setBusy(false);
    }
  }

  btnLookup.addEventListener('click', onLookup);
  btnPickApart.addEventListener('click', onPickApart);
  btnFaults.addEventListener('click', onFaults);

  // Quick enter-to-search from plate/vin
  [elPlate, elVin].forEach((el) => {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') onLookup();
    });
  });

  // Try to preload makes without blocking
  loadPickApartMakes().catch(function () {});
})();

