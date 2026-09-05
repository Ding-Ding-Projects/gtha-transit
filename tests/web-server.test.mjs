import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as pause} from 'node:timers/promises';
import http from 'node:http';
test('Real HTTP server serves provenance and isolates private backend failures',{timeout:10000},async()=>{
 const child=spawn(process.execPath,['server/web.mjs'],{env:{...process.env,PORT:'18784',HOST:'127.0.0.1',ROUTING_ORIGIN:'http://127.0.0.1:1'}});let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
 try{for(let i=0;i<50&&!log.includes('ready');i++)await pause(50);assert.match(log,/ready/);const health=await fetch('http://127.0.0.1:18784/health');assert.equal(health.status,200);assert.equal((await health.json()).ok,true);const api=await fetch('http://127.0.0.1:18784/api/coverage');assert.equal(api.status,503);const output=await api.text();assert.equal(output.includes('127.0.0.1'),false);assert.equal(api.headers.get('referrer-policy'),'no-referrer');const page=await fetch('http://127.0.0.1:18784/');assert.equal(page.status,200);assert.match(await page.text(),/GTHA/);}
 finally{child.kill();await once(child,'exit');}
});

test('Real tile proxy preserves revision paths and never caches mutable or rejected tiles', {timeout:10000}, async()=>{
 const revision='a'.repeat(64), paths=[];
 const maps=http.createServer((req,res)=>{paths.push(req.url); if(req.url==='/map-info'){res.setHeader('content-type','application/json');res.end(JSON.stringify({revision}));return;} if(req.url.includes('b'.repeat(64))){res.writeHead(409);res.end();return;}res.setHeader('content-type','image/png');res.end(Buffer.from([137,80,78,71]));});
 await new Promise(resolve=>maps.listen(0,'127.0.0.1',resolve));
 const child=spawn(process.execPath,['server/web.mjs'],{env:{...process.env,PORT:'18785',HOST:'127.0.0.1',ROUTING_ORIGIN:'http://127.0.0.1:1',MAPS_ORIGIN:`http://127.0.0.1:${maps.address().port}`}});
 let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
 try{
  for(let i=0;i<50&&!log.includes('ready');i++)await pause(50);assert.match(log,/ready/);
  const info=await fetch('http://127.0.0.1:18785/api/map-info');assert.equal(info.status,200);assert.equal(info.headers.get('cache-control'),'no-store');assert.equal((await info.json()).revision,revision);
  const versioned=await fetch(`http://127.0.0.1:18785/tiles/${revision}/11/570/747.png`);assert.equal(versioned.status,200);assert.match(versioned.headers.get('cache-control'),/immutable/);
  const plain=await fetch('http://127.0.0.1:18785/tiles/11/570/747.png');assert.equal(plain.headers.get('cache-control'),'no-cache');
  const old=await fetch(`http://127.0.0.1:18785/tiles/${'b'.repeat(64)}/11/570/747.png`);assert.equal(old.status,404);assert.equal(old.headers.get('cache-control'),'no-store');
  assert.ok(paths.includes(`/tiles/${revision}/11/570/747.png`));
 }finally{child.kill();await once(child,'exit');await new Promise(resolve=>maps.close(resolve));}
});

test('Place proxy ranks local intersections before a capped stop list and retains a healthy source', {timeout: 10000}, async () => {
 let routingAvailable = true;
 const routing = http.createServer((req, res) => {
  if (!req.url.startsWith('/api/places')) return res.writeHead(404).end();
  if (!routingAvailable) return res.writeHead(503).end();
  const places = Array.from({ length: 20 }, (_, index) => ({ id: `routing:${index}`, name: `Yonge Eglinton Stop ${index}`, kind: 'stop' }));
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ places }));
 });
 const maps = http.createServer((req, res) => {
  if (!req.url.startsWith('/search')) return res.writeHead(404).end();
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ results: [
   { id: 'map:yonge-eglinton', name: 'Yonge Street & Eglinton Avenue', kind: 'intersection', lat: null, lon: null },
   { id: 'routing:0', name: 'Yonge Eglinton Stop 0', kind: 'stop', lat: null, lon: null },
  ] }));
 });
 await new Promise((resolve) => routing.listen(0, '127.0.0.1', resolve));
 await new Promise((resolve) => maps.listen(0, '127.0.0.1', resolve));
 const probe = http.createServer();
 await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
 const port = probe.address().port;
 await new Promise((resolve) => probe.close(resolve));
 const child = spawn(process.execPath, ['server/web.mjs'], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ROUTING_ORIGIN: `http://127.0.0.1:${routing.address().port}`, MAPS_ORIGIN: `http://127.0.0.1:${maps.address().port}` } });
 let log = '';
 child.stdout.on('data', (data) => { log += data; });
 child.stderr.on('data', (data) => { log += data; });
 try {
  for (let attempt = 0; attempt < 50 && !log.includes('ready'); attempt += 1) await pause(50);
  assert.match(log, /ready/);
  const full = await fetch(`http://127.0.0.1:${port}/api/places?q=Yonge%20Eglinton`);
  assert.equal(full.status, 200);
  const fullPayload = await full.json();
  assert.equal(fullPayload.partial, false);
  assert.deepEqual(fullPayload.sources, { routing: 'available', maps: 'available' });
  assert.equal(fullPayload.places[0].id, 'map:yonge-eglinton');
  assert.equal(fullPayload.places.filter((place) => place.id === 'routing:0').length, 1);
  assert.equal(fullPayload.places.length, 21);
  routingAvailable = false;
  const partial = await fetch(`http://127.0.0.1:${port}/api/places?q=Yonge%20Eglinton`);
  assert.equal(partial.status, 200);
  const partialPayload = await partial.json();
  assert.equal(partialPayload.partial, true);
  assert.deepEqual(partialPayload.sources, { routing: 'unavailable', maps: 'available' });
  assert.deepEqual(partialPayload.places.map((place) => place.id), ['map:yonge-eglinton', 'routing:0']);
 } finally {
  child.kill();
  await once(child, 'exit');
  await new Promise((resolve) => routing.close(resolve));
  await new Promise((resolve) => maps.close(resolve));
 }
});
