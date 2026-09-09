(function () {
  'use strict';

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  const FIELD_LABELS = {
    wofExpiry: 'WOF expiry',
    regoExpiry: 'Rego expiry',
    stolen: 'Stolen',
    ppsr: 'PPSR',
    japanHistory: 'Japan history',
    ownership: 'Ownership',
    fullWofHistory: 'Full WOF history',
  };

  const NIR_LABELS = {
    ppsr_money_owing: 'PPSR / money owing',
    ownership_history: 'Ownership history',
    full_wof_history: 'Full WOF history',
    wof_fail_streaks: 'WOF fail streaks',
    japan_history: 'Japan history',
    market_band: 'Market band',
  };

  const LEVEL_LABELS = {
    live: 'Snapshot',
    verify_separately: 'Verify separately',
    unknown: 'Unknown',
    not_in_report: 'Not in report',
  };

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** ISO date (YYYY-MM-DD) or datetime → NZ display e.g. 23 Sep 2025 */
  function formatNzDate(iso) {
    if (!iso) return null;
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return esc(iso);
    const y = m[1];
    const mo = parseInt(m[2], 10);
    const d = parseInt(m[3], 10);
    return d + ' ' + MONTHS[mo - 1] + ' ' + y;
  }

  function formatPulledAt(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return esc(iso);
      // Always display in NZ local time (box clock may be UTC)
      const parts = new Intl.DateTimeFormat('en-NZ', {
        timeZone: 'Pacific/Auckland',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      }).formatToParts(d);
      const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
      const mon = get('month').replace('.', '');
      return get('day') + ' ' + mon + ' ' + get('year') + ', ' + get('hour') + ':' + get('minute');
    } catch (_) {
      return esc(iso);
    }
  }

  function isDatePast(iso) {
    if (!iso) return false;
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return false;
    const end = new Date(parseInt(m[1],10), parseInt(m[2],10)-1, parseInt(m[3],10), 23, 59, 59);
    return end < new Date();
  }

  function titleCaseColour(c) {
    if (!c) return '';
    return c.charAt(0) + c.slice(1).toLowerCase();
  }

  /** Tiny per-field source + as-of chip */
  function sourceChip(sourceLabel, pulledAt) {
    const when = formatPulledAt(pulledAt);
    return (
      '<div class="field-source">' +
        '<span class="src-name">' + esc(sourceLabel) + '</span>' +
        (when ? '<span class="src-asof">as of ' + esc(when) + '</span>' : '') +
      '</div>'
    );
  }

  function renderIdentity(live) {
    const parts = [live.year, live.make, live.model].filter(Boolean).join(' ');
    const colour = live.colour ? titleCaseColour(live.colour) : '';
    const pulled = formatPulledAt(live.pulledAt);
    return (
      '<section class="card identity-card rise" aria-label="Vehicle identity">' +
        '<div class="identity">' +
          '<div class="plate-wrap">' +
            '<span class="plate-badge">' + esc(live.plate) + '</span>' +
            '<span class="plate-reflection" aria-hidden="true"></span>' +
          '</div>' +
          '<div class="identity-copy">' +
            '<p class="vehicle-title">' + esc(parts) + '</p>' +
            (colour ? '<p class="vehicle-meta">' + esc(colour) + '</p>' : '') +
          '</div>' +
        '</div>' +
        '<p class="live-source identity-source">' +
          'Frozen sample snapshot · NZTA Check Expiry + Police (not live-pulled on this host)' +
          (pulled ? ' · As of ' + esc(pulled) : '') +
        '</p>' +
      '</section>'
    );
  }

  /** Expiry status — never “clear”; blank = not shown */
  function expiryBadge(isoDate) {
    if (!isoDate) return '<span class="badge badge-nir">Not pulled</span>';
    if (isDatePast(isoDate)) return '<span class="badge badge-bad">Expired</span>';
    return '<span class="badge badge-ok">Current</span>';
  }

  function snapshotBadge() {
    return '<span class="badge badge-live">Snapshot</span>';
  }

  function rucBadge(status) {
    if (status === 'not_subject') return '<span class="badge badge-neutral">Not subject</span>';
    if (status === 'subject') return '<span class="badge badge-warn">Subject</span>';
    return '<span class="badge badge-nir">Not pulled</span>';
  }

  /**
   * Stolen: show word “No” + Snapshot badge only.
   * Do NOT use green CLEAR / checkmark language (Red Team: blank≠clear).
   * Do NOT treat stolen-no as a walk driver (filtered in renderVerdict).
   */
  function stolenBadges(value) {
    if (value === 'yes') return '<span class="badge badge-bad">Stolen</span> <span class="badge badge-live">Snapshot</span>';
    if (value === 'no') return '<span class="badge badge-live">Snapshot</span>';
    return '<span class="badge badge-nir">Not pulled</span>';
  }

  function liveItem(opts) {
    return (
      '<div class="live-item">' +
        '<div class="label">' + esc(opts.label) + '</div>' +
        '<div class="value' + (opts.valueClass ? ' ' + opts.valueClass : '') + '">' + opts.valueHtml + '</div>' +
        '<div class="live-item-badges">' + (opts.badges || '') + '</div>' +
        sourceChip(opts.source, opts.pulledAt) +
      '</div>'
    );
  }

  function renderLive(live) {
    const wof = formatNzDate(live.wofExpiry);
    const rego = formatNzDate(live.regoExpiry);
    const cof = formatNzDate(live.cofExpiry);
    const rucValue =
      live.rucStatus === 'not_subject' ? 'Not subject' :
      live.rucStatus === 'subject' ? (live.rucDue ? formatNzDate(live.rucDue) : 'Subject') :
      '—';
    const stolenWord =
      live.stolen === 'no' ? 'No' :
      live.stolen === 'yes' ? 'Yes' :
      '—';
    const stolenCls =
      live.stolen === 'no' ? 'stolen-no' :
      live.stolen === 'yes' ? 'stolen-yes' : '';

    let items = '';

    items += liveItem({
      label: 'WOF expiry',
      valueHtml: wof ? esc(wof) : '—',
      badges: expiryBadge(live.wofExpiry) + ' ' + snapshotBadge(),
      source: 'NZTA Check Expiry',
      pulledAt: live.pulledAt,
    });

    // CoF only when present — never invent
    if (live.cofExpiry) {
      items += liveItem({
        label: 'CoF expiry',
        valueHtml: cof ? esc(cof) : '—',
        badges: expiryBadge(live.cofExpiry) + ' ' + snapshotBadge(),
        source: 'NZTA Check Expiry',
        pulledAt: live.pulledAt,
      });
    }

    items += liveItem({
      label: 'Rego expiry',
      valueHtml: rego ? esc(rego) : '—',
      badges: expiryBadge(live.regoExpiry) + ' ' + snapshotBadge(),
      source: 'NZTA Check Expiry',
      pulledAt: live.pulledAt,
    });

    items += liveItem({
      label: 'RUC',
      valueHtml: esc(rucValue),
      badges: rucBadge(live.rucStatus) + (live.rucStatus !== 'unknown' ? ' ' + snapshotBadge() : ''),
      source: 'NZTA Check Expiry',
      pulledAt: live.pulledAt,
    });

    items += liveItem({
      label: 'Stolen',
      valueHtml: esc(stolenWord),
      valueClass: stolenCls,
      badges: stolenBadges(live.stolen),
      source: 'Police',
      pulledAt: live.pulledAt,
    });

    // JP import: omit from live body unless confirmed (fixture has japan_history as not_in_report)

    return (
      '<section class="card rise" aria-label="Live dates and status">' +
        '<h2>Dates &amp; status <span class="h2-sub">(frozen sample)</span></h2>' +
        '<div class="live-grid">' + items + '</div>' +
      '</section>'
    );
  }

  function renderVerdict(v) {
    const cls = v.verdict === 'walk' ? 'walk' : v.verdict === 'caution' ? 'caution' : 'go';
    // Red Team: don't list stolen-no as a driver — reads like a clearance badge
    const drivers = (v.drivers || []).filter(function (d) {
      return !/^stolen:\s*no$/i.test(String(d).trim());
    }).map(function (d) {
      return '<li class="driver-chip">' + esc(d) + '</li>';
    }).join('');
    return (
      '<section class="card verdict-card ' + cls + ' rise" data-verdict="' + esc(v.verdict) + '" aria-label="Verdict">' +
        '<div class="verdict-accent" aria-hidden="true"></div>' +
        '<div class="verdict-inner">' +
          '<span class="verdict-pill">' + esc(v.verdict) + '</span>' +
          '<h3 class="verdict-headline">' + esc(v.headline) + '</h3>' +
          (drivers ? '<ul class="drivers">' + drivers + '</ul>' : '') +
        '</div>' +
      '</section>'
    );
  }

  function renderConfidence(items) {
    const chips = (items || []).map(function (c) {
      const label = FIELD_LABELS[c.field] || c.field;
      const lvl = LEVEL_LABELS[c.level] || c.level;
      const badgeCls =
        c.level === 'live' ? 'badge-live' :
        c.level === 'verify_separately' ? 'badge-warn' :
        'badge-nir';
      return (
        '<span class="conf-chip">' +
          '<span class="field">' + esc(label) + '</span>' +
          '<span class="badge ' + badgeCls + '">' + esc(lvl) + '</span>' +
        '</span>'
      );
    }).join('');
    return (
      '<section class="card rise" aria-label="Confidence">' +
        '<h2>Confidence</h2>' +
        '<div class="confidence-list">' + chips + '</div>' +
      '</section>'
    );
  }

  function renderModelPack(mp) {
    const gate = mp.variantGate || {};
    const gated = gate.confirmed === false;
    const assumeLabel = gate.assumedIf
      ? 'Show pack assuming … ' + gate.assumedIf.replace(/^If this /i, '')
      : 'Show pack assuming variant';

    let body = '';
    if (mp.faults && mp.faults.length) {
      body += '<h3 class="subhead">Known faults (make–model–year)</h3><ul class="fault-list">';
      mp.faults.forEach(function (f) {
        body +=
          '<li><div class="name">' + esc(f.name) + '</div>' +
          (f.typicalKm ? '<div class="detail">Typical km: ' + esc(f.typicalKm) + '</div>' : '') +
          '<div class="detail">How to check: ' + esc(f.howToCheck) + '</div></li>';
      });
      body += '</ul>';
    }
    if (mp.fluids && mp.fluids.length) {
      body += '<h3 class="subhead">Fluids</h3><ul class="fluid-list">';
      mp.fluids.forEach(function (f) {
        body +=
          '<li><div class="name">' + esc(f.item) + '</div>' +
          '<div class="detail">' + esc(f.spec) +
          (f.interval ? ' · ' + esc(f.interval) : '') +
          '</div></li>';
      });
      body += '</ul>';
    }
    if (mp.topCosts && mp.topCosts.length) {
      body += '<h3 class="subhead">NZ cost guides (ballpark)</h3><ul class="cost-list">';
      mp.topCosts.forEach(function (c) {
        body +=
          '<li><div class="name">' + esc(c.item) + '</div>' +
          '<div class="detail">' + esc(c.nzGuideBallpark) + '</div></li>';
      });
      body += '</ul>';
    }

    return (
      '<section class="card rise" aria-label="Model risk pack" id="model-pack">' +
        '<h2>Model risk pack</h2>' +
        '<p class="disclaimer">' + esc(mp.disclaimer) + '</p>' +
        '<div class="gate-banner">' +
          '<strong>Variant gate — ' + esc(gate.required || 'Confirm variant') + '</strong>' +
          (gate.assumedIf ? '<p>' + esc(gate.assumedIf) + '</p>' : '<p></p>') +
          (gated
            ? '<button type="button" class="btn-assume" id="btn-assume" aria-expanded="false" aria-controls="model-pack-body">' +
                esc(assumeLabel) +
              '</button>'
            : '') +
        '</div>' +
        '<div class="model-body" id="model-pack-body"' + (gated ? ' hidden' : '') + '>' +
          body +
        '</div>' +
        (gated
          ? '<p class="model-pack-print-omit disclaimer">Variant not confirmed — pack omitted from print.</p>'
          : '') +
      '</section>'
    );
  }

  function renderSeller(sq) {
    const items = (sq.questions || []).map(function (q) {
      return '<li>' + esc(q) + '</li>';
    }).join('');
    return (
      '<section class="card rise" aria-label="Seller questions">' +
        '<h2>Seller questions</h2>' +
        '<ol class="q-list">' + items + '</ol>' +
      '</section>'
    );
  }

  function renderWalkaround(w) {
    const items = (w.items || []).map(function (i) {
      return (
        '<li><span class="check-box" aria-hidden="true"></span><span>' + esc(i) + '</span></li>'
      );
    }).join('');
    return (
      '<section class="card rise" aria-label="Walkaround checklist">' +
        '<h2>Walkaround checklist</h2>' +
        '<ul class="check-list">' + items + '</ul>' +
      '</section>'
    );
  }

  /** Grey/amber only — never greens or checkmarks on PPSR/JP/ownership/full WOF */
  function renderNotInReport(nir) {
    const items = (nir.items || []).map(function (it) {
      const label = NIR_LABELS[it.key] || it.key;
      const statusLabel = LEVEL_LABELS[it.status] || it.status;
      const badgeCls = it.status === 'verify_separately' ? 'badge-warn' : 'badge-nir';
      return (
        '<li class="nir-item">' +
          '<span class="nir-key">' + esc(label) + '</span>' +
          '<span class="badge ' + badgeCls + '">' + esc(statusLabel) + '</span>' +
          (it.note ? '<p class="nir-note">' + esc(it.note) + '</p>' : '') +
        '</li>'
      );
    }).join('');
    return (
      '<section class="card nir-card rise" aria-label="Not in this report">' +
        '<h2>Not in this report — verify separately</h2>' +
        '<p class="nir-lead">Always verify PPSR / money owing separately until licensed. Blank ≠ clear.</p>' +
        '<ul class="nir-list">' + items + '</ul>' +
      '</section>'
    );
  }

  function renderRecall(r) {
    return (
      '<section class="card rise" aria-label="Recalls">' +
        '<h2>Recalls</h2>' +
        '<p class="recall-note">' + esc(r.note) + '</p>' +
      '</section>'
    );
  }

  function wireGate() {
    const btn = document.getElementById('btn-assume');
    const body = document.getElementById('model-pack-body');
    if (!btn || !body) return;
    btn.addEventListener('click', function () {
      const open = body.hasAttribute('hidden');
      if (open) {
        body.removeAttribute('hidden');
        btn.setAttribute('aria-expanded', 'true');
        btn.textContent = 'Hide assumed pack';
      } else {
        body.setAttribute('hidden', '');
        btn.setAttribute('aria-expanded', 'false');
        if (btn.dataset.label) btn.textContent = btn.dataset.label;
      }
    });
    btn.dataset.label = btn.textContent;
  }

  /**
   * Stack order (Autobots UI lock):
   * 1. Identity (plate + year make model colour)
   * 2. Verdict FIRST (above the fold with identity)
   * 3. Live dates / stolen
   * 4. Confidence (supporting)
   * 5. Model pack (if-variant gate)
   * 6. Not in this report
   * 7. Seller / walkaround / recall
   */
  function renderDemoBanner() {
    return (
      '<div class="demo-banner" role="status">' +
        '<strong>DEMO · SAMPLE REPORT — KQM299 only</strong>' +
        '<span>Frozen fixture. This static host does not pull NZTA or Police live.</span>' +
      '</div>'
    );
  }

  function renderStaticDisclaimer(live) {
    const when = formatPulledAt(live && live.pulledAt);
    return (
      '<aside class="static-disclaimer card rise" aria-label="Static sample disclaimer">' +
        '<p><strong>Static sample only.</strong> This page is a frozen snapshot of plate <strong>KQM299</strong>. ' +
        'It does <em>not</em> query NZTA Check Expiry or Police on this host. ' +
        'Dates and status below are from the sample fixture' +
        (when ? ' (as of ' + esc(when) + ')' : '') +
        '. Source and as-of chips mark where each field came from in the snapshot — not a live pull.</p>' +
        '<p class="static-disclaimer-note">Plate lookup is disabled. No free plate check on this deploy.</p>' +
      '</aside>'
    );
  }

  function render(report) {
    const root = document.getElementById('report');
    root.innerHTML =
      renderDemoBanner() +
      renderStaticDisclaimer(report.live) +
      '<div class="hero-stack">' +
        renderIdentity(report.live) +
        renderVerdict(report.verdict) +
      '</div>' +
      renderLive(report.live) +
      renderConfidence(report.confidence) +
      renderModelPack(report.modelPack) +
      renderNotInReport(report.notInReport) +
      renderSeller(report.sellerQuestions) +
      renderWalkaround(report.walkaround) +
      renderRecall(report.recall) +
      '<p class="footer-note">Autotek Diagnostics · DEMO / SAMPLE · Frozen KQM299 only · Not a substitute for a physical inspection or PPSR · This static host does not pull NZTA/Police live</p>';

    wireGate();
  }

  function showError(msg) {
    const root = document.getElementById('report');
    root.innerHTML = '<p class="error">' + esc(msg) + '</p>';
  }

  // Prefer fetch of fixture; fall back to embedded if file:// blocks fetch
  function boot() {
    const embedded = window.__AUTOTEK_FIXTURE__;
    fetch('fixtures/kqm299.json')
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(render)
      .catch(function () {
        if (embedded) {
          render(embedded);
        } else {
          showError('Could not load fixtures/kqm299.json. Serve this folder over HTTP, or open via the local preview server.');
        }
      });
  }

  document.getElementById('btn-print') &&
    document.getElementById('btn-print').addEventListener('click', function () {
      window.print();
    });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
