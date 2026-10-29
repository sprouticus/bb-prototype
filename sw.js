const CACHE = 'bb-site';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];
const PAGE_TIMEOUT = 4000;
const SCOPE = new URL(self.registration.scope);

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

function isPage(request, url) {
  return request.mode === 'navigate' || /\.html$/.test(url.pathname) || url.pathname.endsWith('/');
}

function isCode(url) {
  return /\.(css|js|webmanifest|json|xml|txt)$/.test(url.pathname);
}

function candidates(url) {
  const base = url.origin + url.pathname;
  const list = [base];
  if (base.endsWith('/')) list.push(base + 'index.html');
  else if (base.endsWith('/index.html')) list.push(base.slice(0, -10));
  else if (!/\.[a-z0-9]+$/i.test(url.pathname)) list.push(base + '.html', base + '/index.html');
  return list;
}

async function fromCache(url) {
  const cache = await caches.open(CACHE);
  for (const key of candidates(url)) {
    const hit = await cache.match(key, { ignoreSearch: true, ignoreVary: true });
    if (hit) return hit;
  }
  return undefined;
}

async function store(request, response) {
  if (!response || !(response.ok || response.type === 'opaque') || response.status === 206) return response;
  const cache = await caches.open(CACHE);
  await cache.put(request, response.clone());
  return response;
}

function withTimeout(promise, ms) {
  return new Promise(function (resolve, reject) {
    const timer = setTimeout(function () { reject(new Error('timeout')); }, ms);
    promise.then(function (v) { clearTimeout(timer); resolve(v); }, function (e) { clearTimeout(timer); reject(e); });
  });
}

async function networkFirst(request, url) {
  const cached = await fromCache(url);
  const live = fetch(request).then(function (res) {
    if (res.ok && !res.redirected) store(new Request(url.origin + url.pathname), res.clone());
    return res;
  });
  try {
    return cached ? await withTimeout(live, PAGE_TIMEOUT) : await live;
  } catch (err) {
    if (cached) return cached;
    if (isPage(request, url)) {
      const notFound = await fromCache(new URL('404.html', SCOPE));
      if (notFound) return notFound;
    }
    throw err;
  }
}

async function rangeResponse(request, response) {
  const blob = await response.blob();
  const match = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') || '');
  const size = blob.size;
  let start = match && match[1] ? parseInt(match[1], 10) : 0;
  let end = match && match[2] ? parseInt(match[2], 10) : size - 1;
  if (match && !match[1] && match[2]) {
    start = Math.max(0, size - parseInt(match[2], 10));
    end = size - 1;
  }
  end = Math.min(end, size - 1);
  if (start > end || start >= size) {
    return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  }
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes'
    }
  });
}

async function cacheFirst(request, url) {
  const cached = await fromCache(url);
  if (cached) {
    return request.headers.has('range') ? rangeResponse(request, cached) : cached;
  }
  if (request.headers.has('range')) return fetch(request);
  return store(new Request(url.origin + url.pathname), await fetch(request));
}

async function fontFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request.url, { ignoreVary: true });
  if (cached) return cached;
  return store(request, await fetch(request));
}

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === SCOPE.origin) {
    if (!url.pathname.startsWith(SCOPE.pathname)) return;
    if (url.pathname.endsWith('/sw.js')) return;
    event.respondWith(isPage(request, url) || isCode(url) ? networkFirst(request, url) : cacheFirst(request, url));
  } else if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(fontFirst(request));
  }
});

const ATTR = /(?:src|href|poster|data-full)\s*=\s*["']([^"']+)["']/gi;
const SRCSET = /srcset\s*=\s*["']([^"']+)["']/gi;
const CSS_URL = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;

function linksIn(text, base) {
  const found = [];
  let m;
  ATTR.lastIndex = 0;
  while ((m = ATTR.exec(text))) found.push(m[1]);
  SRCSET.lastIndex = 0;
  while ((m = SRCSET.exec(text))) m[1].split(',').forEach(function (part) { found.push(part.trim().split(/\s+/)[0]); });
  CSS_URL.lastIndex = 0;
  while ((m = CSS_URL.exec(text))) found.push(m[1]);
  const out = [];
  found.forEach(function (raw) {
    if (!raw || /^(data:|mailto:|tel:|javascript:|#)/i.test(raw) || raw.indexOf("'") !== -1 || raw.indexOf('+') !== -1) return;
    let u;
    try { u = new URL(raw.replace(/&amp;/g, '&'), base); } catch (e) { return; }
    u.hash = '';
    if (u.origin === SCOPE.origin) {
      if (!u.pathname.startsWith(SCOPE.pathname) || u.pathname.endsWith('/sw.js')) return;
      u.search = '';
      out.push(u.href);
    } else if (u.hostname === 'fonts.googleapis.com' && u.pathname.startsWith('/css')) {
      out.push(u.href);
    } else if (u.hostname === 'fonts.gstatic.com') {
      out.push(u.href);
    }
  });
  return out;
}

async function refresh(cache, href) {
  const url = new URL(href);
  if (url.origin !== SCOPE.origin) {
    const hit = await cache.match(href, { ignoreVary: true });
    if (hit) return hit;
    const res = await fetch(href, { mode: 'cors', credentials: 'omit' });
    if (!res.ok) throw new Error(res.status + ' ' + href);
    await cache.put(href, res.clone());
    return res;
  }
  const cached = await cache.match(href);
  const headers = {};
  if (cached) {
    const etag = cached.headers.get('ETag');
    const modified = cached.headers.get('Last-Modified');
    if (etag) headers['If-None-Match'] = etag;
    if (modified) headers['If-Modified-Since'] = modified;
  }
  const res = await fetch(href, { headers: headers, cache: 'no-store' });
  if (res.status === 304 && cached) return cached;
  if (res.ok && !res.redirected) {
    await cache.put(href, res.clone());
    return res;
  }
  if (res.redirected && res.ok) return res;
  throw new Error(res.status + ' ' + href);
}

function shouldParse(href, res) {
  const type = (res.headers.get('Content-Type') || '').toLowerCase();
  return type.indexOf('text/html') !== -1 || type.indexOf('text/css') !== -1 || /\.(html|css)$/.test(new URL(href).pathname) || href.endsWith('/');
}

let saving = null;

async function saveSite(report) {
  const cache = await caches.open(CACHE);
  const queue = [SCOPE.href, new URL('404.html', SCOPE).href, new URL('manifest.webmanifest', SCOPE).href, new URL('offline.js', SCOPE).href];
  const seen = new Set(queue);
  const kept = new Set();
  let done = 0;
  let failed = 0;
  const workers = [];

  async function work() {
    while (queue.length) {
      const href = queue.shift();
      try {
        const res = await refresh(cache, href);
        kept.add(href);
        if (shouldParse(href, res)) {
          const base = res.redirected ? res.url : href;
          linksIn(await res.clone().text(), base).forEach(function (next) {
            if (!seen.has(next)) {
              seen.add(next);
              queue.push(next);
            }
          });
        }
      } catch (e) {
        if (new URL(href).origin === SCOPE.origin) failed++;
      }
      done++;
      report({ type: 'progress', done: done, total: seen.size });
    }
  }

  while (queue.length || workers.length) {
    while (workers.length < 4 && queue.length) {
      const w = work().then(function () { workers.splice(workers.indexOf(w), 1); });
      workers.push(w);
    }
    await Promise.race(workers);
  }

  if (!failed) {
    const keys = await cache.keys();
    await Promise.all(keys.map(function (req) {
      const u = new URL(req.url);
      if (u.origin === SCOPE.origin && !kept.has(req.url)) return cache.delete(req);
      return null;
    }));
  }
  return { type: 'saved', done: done, failed: failed };
}

self.addEventListener('message', function (event) {
  if (!event.data || event.data.type !== 'save-site') return;
  const source = event.source;
  function report(msg) { if (source) source.postMessage(msg); }
  if (!saving) {
    saving = saveSite(report).finally(function () { saving = null; });
  }
  event.waitUntil(saving.then(report, function () { report({ type: 'saved', failed: 1 }); }));
});
