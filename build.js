// Builds one dashboard page per client in clients/*.json into site/<client>/index.html.
// Each client's data comes from the Google Sheets that Stract refreshes, through their
// "Publish to web" CSV links, kept as GitHub secrets (never committed to the repo).
// Local test: CSV_DIR=folder node build.js  (reads <secret name>.csv files from that folder)
const fs = require('fs');
const path = require('path');

const META_COLS = {
  day: [0, 'date'], campaign: [1, 'campaign'], spend: [2, 'spend'], impressions: [3, 'impressions'],
  clicks: [5, 'link click'],
};
// What counts as a Meta lead: every column whose header contains one of these words.
// A client can set its own list with "metaLeadWords" in clients/<client>.json.
const META_LEAD_WORDS = ['lead grouped', 'pixel lead', 'messaging', 'call placed'];
const GOOGLE_COLS = {
  day: [0, 'date'], campaign: [1, 'campaign'], spend: [2, 'cost'], impressions: [3, 'impressions'],
  clicks: [4, 'clicks'], conversions: [5, 'conversions'], calls: [6, 'phone calls'],
};

function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function toDay(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // pt-BR dd/mm/yyyy
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

function toNum(v) {
  let s = String(v || '').trim().replace(/[^\d,.\-]/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); // pt-BR 1.234,56
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function readRows(text, cols, leadWords) {
  const values = parseCsv(text);
  if (values.length < 2) return [];
  const head = values[0].map((h) => h.toLowerCase());
  const idx = {};
  for (const [k, [pos, word]] of Object.entries(cols)) {
    const f = head.findIndex((h) => h.includes(word));
    idx[k] = f !== -1 ? f : pos;
  }
  const leadIdx = (leadWords || []).flatMap((w) => head.map((h, i) => (h.includes(w.toLowerCase()) ? i : -1)).filter((i) => i !== -1));
  if (leadWords && !leadIdx.length) throw new Error(`no lead columns found (looked for: ${leadWords.join(', ')})`);
  const out = [];
  for (const row of values.slice(1)) {
    const day = toDay(row[idx.day]);
    if (!day) continue;
    const r = { day, campaign: row[idx.campaign] || '(no name)' };
    for (const k of Object.keys(cols)) if (k !== 'day' && k !== 'campaign') r[k] = toNum(row[idx[k]]);
    if (leadWords) r.leads = [...new Set(leadIdx)].reduce((a, i) => a + toNum(row[i]), 0);
    out.push(r);
  }
  return out;
}

async function getCsv(secretName) {
  if (!secretName) return null;
  if (process.env.CSV_DIR) {
    const f = path.join(process.env.CSV_DIR, secretName + '.csv');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  }
  const url = process.env[secretName];
  if (!url) { const e = new Error(`secret ${secretName} is not set yet`); e.missingSecret = true; throw e; }
  // A normal sheet link (…/d/<id>/edit) also works once the sheet is published to the web.
  const m = url.match(/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/);
  const gid = (url.match(/[#&?]gid=(\d+)/) || [])[1] || '0';
  const csvUrl = m ? `https://docs.google.com/spreadsheets/d/${m[1]}/gviz/tq?tqx=out:csv&gid=${gid}` : url;
  const res = await fetch(csvUrl.trim(), { redirect: 'follow' });
  if (!res.ok) throw new Error(`Could not download ${secretName}: HTTP ${res.status}`);
  const text = await res.text();
  if (/^\s*</.test(text)) throw new Error(`${secretName} returned a web page, not a CSV. Check that the sheet is published as CSV.`);
  return text;
}

async function buildClient(slug, cfg, template) {
  const metaCsv = await getCsv(cfg.metaCsvSecret);
  const googleCsv = await getCsv(cfg.googleCsvSecret);
  const meta = metaCsv ? readRows(metaCsv, META_COLS, cfg.metaLeadWords || META_LEAD_WORDS) : [];
  let google = googleCsv ? readRows(googleCsv, GOOGLE_COLS).map((r) => ({
    day: r.day, campaign: r.campaign, spend: r.spend, impressions: r.impressions, clicks: r.clicks,
    leads: r.conversions + r.calls,
  })) : [];
  // Safety net: if Google cost arrived in micros, convert to currency.
  if (google.some((r) => r.spend > 100000)) google = google.map((r) => ({ ...r, spend: r.spend / 1e6 }));
  const data = {
    client: cfg.name, currency: cfg.currency || 'USD', locale: cfg.locale || 'en-US',
    metaLeadsNote: cfg.metaLeadsNote || null, resultOne: cfg.resultOne || null, resultMany: cfg.resultMany || null, hasMeta: !!metaCsv, hasGoogle: !!googleCsv, meta, google, generatedAt: new Date().toISOString(),
  };
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const html = template.replace('/*__DATA__*/null', () => json);
  fs.mkdirSync(path.join('site', slug), { recursive: true });
  fs.writeFileSync(path.join('site', slug, 'index.html'), html);
  console.log(`${slug}: ${meta.length} Meta rows, ${google.length} Google rows`);
  const sum = (rows) => rows.reduce((a, r) => ({ spend: a.spend + r.spend, leads: a.leads + r.leads, clicks: a.clicks + r.clicks }), { spend: 0, leads: 0, clicks: 0 });
  const span = (rows) => rows.length ? `${rows.reduce((m, r) => (r.day < m ? r.day : m), rows[0].day)}..${rows.reduce((m, r) => (r.day > m ? r.day : m), rows[0].day)}` : 'none';
  console.log(`${slug}: Meta ${span(meta)} ${JSON.stringify(sum(meta))}; Google ${span(google)} ${JSON.stringify(sum(google))}`);
}

(async () => {
  const template = fs.readFileSync('template/index.html', 'utf8');
  fs.rmSync('site', { recursive: true, force: true });
  fs.mkdirSync('site');
  fs.writeFileSync('site/index.html', '<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Dashboards</title>');
  fs.writeFileSync('site/robots.txt', 'User-agent: *\nDisallow: /\n');
  let failed = 0;
  for (const f of fs.readdirSync('clients').filter((f) => f.endsWith('.json'))) {
    const slug = f.replace(/\.json$/, '');
    try { await buildClient(slug, JSON.parse(fs.readFileSync(path.join('clients', f), 'utf8')), template); }
    catch (e) {
      if (e.missingSecret) { console.log(`::warning::${slug} skipped: ${e.message}`); continue; }
      failed++; console.error(`${slug}: FAILED - ${e.message}`);
    }
  }
  if (failed) process.exit(1);
})();
