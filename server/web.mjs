import http from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTtcStatus } from '../status/ttc.mjs';
import {createHistoryStore} from '../history/store.mjs';
import {loadRegistry,RealtimeAggregator} from '../realtime/aggregator.mjs';
const realtime=new RealtimeAggregator({registry:await loadRegistry()});
const history=process.env.HISTORY_DIR?createHistoryStore({directory:process.env.HISTORY_DIR}):null;
let collecting=false;
async function collect(){if(!history||collecting)return;collecting=true;try{history.observe(await getTtcStatus());}catch{console.error('Disruption history collection failed; existing records retained.');}finally{collecting=false;}}
if(history){void collect();setInterval(()=>void collect(),60000).unref();}
function historyPage(params){const page=history.query(Object.fromEntries(params));return {records:page.items.map(row=>({...row.payload,id:String(row.occurrenceId),alertId:row.alertId,firstSeen:row.firstSeen,lastSeen:row.lastSeen,status:row.status,versionCount:row.versionCount})),nextCursor:page.nextCursor};}
const root = path.resolve(
  process.env.STATIC_ROOT ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), '../dist/client'),
);
const routing = process.env.ROUTING_ORIGIN || 'http://127.0.0.1:8787';
const maps = process.env.MAPS_ORIGIN || 'http://127.0.0.1:8789';
const intake=process.env.INTAKE_ORIGIN;
const routes = new Set([
  '/api/places',
  '/api/coverage',
  '/api/plan',
  '/api/departures',
]);
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.rsc': 'text/x-component',
};
const send = (res, code, payload) => {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload));
};
async function body(req) {
  const parts = [];
  let size = 0;
  for await (const part of req) {
    size += part.length;
    if (size > 32768) throw Error('Request is too large.');
    parts.push(part);
  }
  return Buffer.concat(parts);
}
async function bounded(res, max = 4 * 1024 * 1024) {
  const parts = [];
  let size = 0;
  for await (const part of res.body) {
    size += part.length;
    if (size > max) throw Error('Response limit exceeded');
    parts.push(part);
  }
  return Buffer.concat(parts);
}
const buckets = new Map();
function allowed(key) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now - b.at > 60000) {
    b = { at: now, n: 0 };
    buckets.set(key, b);
  }
  if (buckets.size > 10000) {
    for (const [k, v] of buckets) if (now - v.at > 60000) buckets.delete(k);
    if (buckets.size > 10000) return false;
  }
  return ++b.n <= 120;
}
let activeRequests=0;
const server = http.createServer(async (req, res) => {
  if(activeRequests>=16)return send(res,503,{error:'The service is busy. Please retry shortly.'});
  activeRequests++;res.once('close',()=>{activeRequests--;});
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader(
    'permissions-policy',
    'camera=(), microphone=(), geolocation=(self)',
  );
  try {
    const url = new URL(req.url, 'http://localhost');
    if(url.pathname==='/setup/metrolinx'&&intake&&['GET','POST'].includes(req.method)){
      const upstream=await fetch(intake+url.pathname+url.search,{method:req.method,headers:{'content-type':req.headers['content-type']||'application/x-www-form-urlencoded'},body:req.method==='POST'?await body(req):undefined,redirect:'error',signal:AbortSignal.timeout(5000)});
      const content=await bounded(upstream,65536);res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')||'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'"});return res.end(content);
    }
    if(url.pathname==='/api/realtime'&&req.method==='GET')return send(res,200,await realtime.refresh());
    if(url.pathname.startsWith('/api/history')&&req.method==='GET'){
      if(!history)return send(res,503,{error:'History storage is unavailable.'});
      if(url.pathname==='/api/history/export'){
        res.writeHead(200,{'content-type':'application/x-ndjson; charset=utf-8','content-disposition':'attachment; filename="ttc-disruption-history.ndjson"','cache-control':'no-store'});
        const params=new URLSearchParams(url.searchParams);params.set('limit','100');params.delete('cursor');let cursor=null;
        do{if(res.destroyed)return;if(cursor)params.set('cursor',cursor);const page=historyPage(params);for(const row of page.records){if(!res.write(JSON.stringify(row)+'\n'))await new Promise(resolve=>{res.once('drain',resolve);res.once('close',resolve);});}cursor=page.nextCursor;}while(cursor);return res.end();
      }
      if(url.pathname==='/api/history'){try{return send(res,200,historyPage(url.searchParams));}catch{return send(res,400,{error:'Invalid history date range or filter.'});}}
    }
    if (req.url.length > 4096)
      return send(res, 414, { error: 'Request URL is too long.' });
    if (url.pathname === '/health')
      return send(res, 200, { ok: true, service: 'gtha-transit-web' });
    if (url.pathname === '/api/status/ttc' && req.method === 'GET')
      return send(res, 200, await getTtcStatus());
    if (routes.has(url.pathname)) {
      if (!allowed(process.env.TRUST_TUNNEL==='1' ? String(req.headers['cf-connecting-ip']||req.socket.remoteAddress).slice(0,80) : req.socket.remoteAddress))
        return send(res, 429, {
          error: 'Too many searches. Please wait a minute.',
        });
      if (
        (url.pathname === '/api/plan' && req.method !== 'POST') ||
        (url.pathname !== '/api/plan' && req.method !== 'GET')
      )
        return send(res, 405, { error: 'Method not allowed.' });
      const input = req.method === 'POST' ? await body(req) : undefined;
      const upstream = await fetch(routing + url.pathname + url.search, {
        method: req.method,
        headers: { 'content-type': 'application/json' },
        body: input,
        signal: AbortSignal.timeout(23000),
        redirect: 'error',
      });
      let payload = await bounded(upstream);
      if (!upstream.ok) {
        return send(res, upstream.status >= 500 ? 503 : upstream.status, {
          error:
            upstream.status >= 500
              ? 'Regional routing is temporarily unavailable. Please try again shortly.'
              : 'The journey request could not be completed. Check the locations, date and preferences.',
        });
      }
      if (url.pathname === '/api/places') {
        try {
          const stops = JSON.parse(payload);
          const r = await fetch(maps + '/search' + url.search, {
            signal: AbortSignal.timeout(2500),
            redirect: 'error',
          });
          if (r.ok) {
            const places = JSON.parse(await bounded(r, 256 * 1024));
            stops.places = [
              ...(stops.places || []),
              ...(places.places || places.results || []),
            ].slice(0, 25);
            payload = Buffer.from(JSON.stringify(stops));
          }
        } catch {}
      }
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      return res.end(payload);
    }
    if (
      /^\/tiles\/\d{1,2}\/\d+\/\d+\.png$/.test(url.pathname) &&
      req.method === 'GET'
    ) {
      const upstream = await fetch(maps + url.pathname, {
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      if (!upstream.ok)
        return send(res, 404, { error: 'Map tile unavailable.' });
      const bytes = await bounded(upstream, 1024 * 1024);
      res.writeHead(200, {
        'content-type': 'image/png',
        'cache-control': 'public,max-age=86400',
      });
      return res.end(bytes);
    }
    if (!['GET', 'HEAD'].includes(req.method))
      return send(res, 405, { error: 'Method not allowed.' });
    const decoded = decodeURIComponent(url.pathname);
    if (decoded.includes('\0') || decoded.includes('\\'))
      return send(res, 400, { error: 'Invalid path.' });
    const target = path.resolve(
      root,
      '.' + (decoded === '/' ? '/index.html' : decoded),
    );
    if (target !== root && !target.startsWith(root + path.sep))
      return send(res, 403, { error: 'Path not allowed.' });
    const info = await stat(target);
    if (!info.isFile()) return send(res, 404, { error: 'Not found.' });
    res.writeHead(200, {
      'content-type': mime[path.extname(target)] || 'application/octet-stream',
      'content-length': info.size,
      'cache-control': target.includes('/_next/')
        ? 'public,max-age=31536000,immutable'
        : 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(target).pipe(res);
  } catch (e) {
    if (!res.headersSent)
      send(res, e?.code === 'ENOENT' ? 404 : 503, {
        error:
          e?.code === 'ENOENT'
            ? 'Not found.'
            : 'This service is temporarily unavailable. Please try again.',
      });
    else res.destroy();
  }
});
server.requestTimeout = 30000;
server.maxConnections=128;
server.headersTimeout = 10000;
server.listen(
  Number(process.env.PORT || 8080),
  process.env.HOST || '0.0.0.0',
  () => console.log('GTHA Transit web service ready'),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => server.close(() => process.exit(0)));
