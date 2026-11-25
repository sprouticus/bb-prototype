/* ------------------------------------------------------------------
   structured-data.test.js  —  run: node structured-data.test.js

   Checks the JSON-LD block on every page against what the page itself
   shows a visitor. Run it after changing any spec, price, page title,
   meta description, or footer contact detail.
   ------------------------------------------------------------------ */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let pass = 0, fail = 0;
function ok(name, cond, extra){
  if (cond) { pass++; }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

const dir = __dirname;
const SITE = 'https://bbengineering.us/';
const pages = fs.readdirSync(dir).filter(n => n.endsWith('.html') && n !== '404.html')
  .filter(n => !/http-equiv="refresh"/i.test(fs.readFileSync(path.join(dir, n), 'utf8')));

const norm = t => String(t).replace(/\s+/g, ' ').replace(/×/g, 'x').replace(/&/g, 'and').trim().toLowerCase();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const data = {};
for (const f of pages){
  const d = new JSDOM(fs.readFileSync(path.join(dir, f), 'utf8')).window.document;
  const blocks = [...d.querySelectorAll('script[type="application/ld+json"]')];
  ok(f + ': has exactly one JSON-LD block', blocks.length === 1, String(blocks.length));
  if (!blocks.length) continue;
  let json = null;
  try { json = JSON.parse(blocks[0].textContent); } catch (e) { ok(f + ': JSON-LD parses', false, e.message); continue; }
  ok(f + ': JSON-LD parses', true);
  ok(f + ': @context is schema.org', json['@context'] === 'https://schema.org');
  const graph = json['@graph'] || [json];
  const byType = t => graph.filter(n => n['@type'] === t);
  data[f] = { d, graph, byType };
}

// --- Organization and WebSite: identical everywhere, and match the footer ---
const org0 = data['index.html'] && data['index.html'].byType('Organization')[0];
const site0 = data['index.html'] && data['index.html'].byType('WebSite')[0];
ok('index.html: has an Organization node', !!org0);
for (const [f, { d, byType }] of Object.entries(data)){
  const org = byType('Organization')[0];
  ok(f + ': Organization matches index.html', org && same(org, org0));
  ok(f + ': WebSite matches index.html', same(byType('WebSite')[0], site0));
  if (!org) continue;
  const hrefs = [...d.querySelectorAll('footer a[href]')].map(a => a.getAttribute('href'));
  const footerText = norm(d.querySelector('footer') ? d.querySelector('footer').textContent : '');
  for (const url of org.sameAs || []) ok(f + ': footer links ' + url, hrefs.includes(url));
  ok(f + ': footer email matches', hrefs.includes('mailto:' + org.email), org.email);
  ok(f + ': footer phone matches', hrefs.includes('tel:' + org.telephone.replace(/-/g, '')), org.telephone);
  ok(f + ': footer shows the street address', footerText.includes(norm(org.address.streetAddress)), org.address.streetAddress);
}

// --- WebPage and breadcrumb: match this page's head ---
for (const [f, { d, graph, byType }] of Object.entries(data)){
  const wp = graph.find(n => /Page$/.test(n['@type']) && n['@type'] !== 'FAQPage');
  if (!wp) { ok(f + ': has a WebPage node', false); continue; }
  const canonical = d.querySelector('link[rel="canonical"]');
  const meta = d.querySelector('meta[name="description"]');
  const url = f === 'index.html' ? SITE : SITE + f;
  ok(f + ': WebPage url is this page', wp.url === url, wp.url);
  ok(f + ': WebPage url matches canonical', canonical && canonical.getAttribute('href') === wp.url,
     canonical && canonical.getAttribute('href'));
  ok(f + ': WebPage name matches <title>', wp.name === d.title, wp.name + ' | ' + d.title);
  ok(f + ': WebPage description matches meta description',
     meta && wp.description === meta.getAttribute('content'), wp.description);
  const crumbs = byType('BreadcrumbList')[0];
  if (crumbs){
    const items = crumbs.itemListElement;
    ok(f + ': breadcrumb positions run 1..n', items.every((it, i) => it.position === i + 1));
    ok(f + ': last breadcrumb is this page', items[items.length - 1].item === url, items[items.length - 1].item);
    for (const it of items){
      const target = it.item === SITE ? 'index.html' : it.item.replace(SITE, '');
      ok(f + ': breadcrumb target exists: ' + target, fs.existsSync(path.join(dir, target)));
    }
  }
}

// --- Product: identical on every page that carries it, and matches specs.html ---
const productPages = Object.keys(data).filter(f => data[f].byType('Product').length);
ok('Product appears on at least specs.html', productPages.includes('specs.html'), productPages.join(', '));
const product = data['specs.html'] && data['specs.html'].byType('Product')[0];
for (const f of productPages){
  ok(f + ': Product matches specs.html', same(data[f].byType('Product')[0], product));
}

if (product){
  const sd = data['specs.html'].d;
  const rows = [...sd.querySelectorAll('.spec-table tr')]
    .map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim()))
    .filter(r => r.length === 2);
  const LABEL = { 'Drive system': 'System' };

  for (const p of product.additionalProperty || []){
    const label = norm(LABEL[p.name] || p.name), value = norm(p.value);
    const hit = rows.some(([k, v]) =>
      (norm(k) === label && norm(v).startsWith(value)) ||
      (norm(v) === 'standard' && (norm(k) === value || norm(k) === label + ', ' + value)));
    const shown = rows.find(([k]) => norm(k) === label);
    ok('Product spec "' + p.name + ': ' + p.value + '" matches specs.html', hit,
       shown ? 'specs.html shows "' + shown[1] + '"' : 'no matching row on specs.html');
  }

  const priceRow = rows.find(([k]) => /^base vehicle/i.test(k));
  const shownPrice = priceRow ? priceRow[1].replace(/[$,]/g, '') : null;
  ok('Product price matches the specs.html pricing table',
     product.offers && product.offers.price === shownPrice,
     (product.offers && product.offers.price) + ' vs ' + (priceRow && priceRow[1]));
  ok('Product currency is USD', product.offers && product.offers.priceCurrency === 'USD');
  ok('Product offer is a pre-order', product.offers && product.offers.availability === 'https://schema.org/PreOrder');
}

// --- FAQPage: every question and answer matches the visible FAQ, word for word ---
const flat = t => String(t).replace(/\s+/g, ' ').trim();
const faqPages = Object.keys(data).filter(f =>
  data[f].byType('FAQPage').length || data[f].d.querySelector('details.faq-item'));
ok('enabler-2-0.html carries a FAQ', faqPages.includes('enabler-2-0.html'), faqPages.join(', '));
for (const f of faqPages){
  const { d, byType } = data[f];
  const nodes = byType('FAQPage');
  ok(f + ': exactly one FAQPage node', nodes.length === 1, String(nodes.length));
  const items = [...d.querySelectorAll('details.faq-item')].map(el => ({
    q: flat(el.querySelector('summary').textContent),
    a: flat(el.querySelector('p').textContent),
    open: el.hasAttribute('open'),
  }));
  ok(f + ': has visible FAQ items', items.length > 0);
  if (!nodes.length) continue;
  const faq = nodes[0];
  const url = f === 'index.html' ? SITE : SITE + f;
  ok(f + ': FAQPage url is this page', faq.url === url, faq.url);
  const qs = faq.mainEntity || [];
  ok(f + ': FAQPage has one Question per visible item', qs.length === items.length, qs.length + ' vs ' + items.length);
  items.forEach((it, i) => {
    const q = qs[i] || {};
    ok(f + ': FAQ ' + (i + 1) + ' is a Question', q['@type'] === 'Question');
    ok(f + ': FAQ ' + (i + 1) + ' question matches the page', q.name === it.q, q.name + ' | ' + it.q);
    ok(f + ': FAQ ' + (i + 1) + ' answer matches the page',
       q.acceptedAnswer && q.acceptedAnswer['@type'] === 'Answer' && q.acceptedAnswer.text === it.a,
       (q.acceptedAnswer && q.acceptedAnswer.text || '').slice(0, 80));
    ok(f + ': FAQ ' + (i + 1) + ' is closed by default', !it.open);
  });
}
if (data['enabler-2-0.html']){
  const n = data['enabler-2-0.html'].d.querySelectorAll('details.faq-item').length;
  ok('enabler-2-0.html: FAQ has 12 questions', n === 12, String(n));
}

// --- visitor-facing strings in the data follow the copy rules ---
for (const [f, { graph }] of Object.entries(data)){
  const strings = [];
  (function walk(v){ if (typeof v === 'string') strings.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(walk); })(graph);
  for (const s of strings){
    if (/^https?:/.test(s)) continue;
    ok(f + ': no em dash in structured data', !s.includes('—'), s.slice(0, 80));
    ok(f + ': no second person in structured data', !/\b(you|your)\b/i.test(s), s.slice(0, 80));
  }
}

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
