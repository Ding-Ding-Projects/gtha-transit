import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as pause} from 'node:timers/promises';
import http from 'node:http';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const cat=(...parts)=>Uint8Array.from(parts.flatMap(part=>[...part]));
const varint=(input)=>{let value=BigInt(input),out=[];do{let byte=Number(value&0x7fn);value>>=7n;if(value)byte|=0x80;out.push(byte);}while(value);return Uint8Array.from(out);};
const scalar=(field,value)=>cat(varint(field<<3),varint(value));
const bytes=(field,value)=>cat(varint((field<<3)|2),varint(value.length),value);
const string=(field,value)=>bytes(field,new TextEncoder().encode(value));
const f32=(field,value)=>{const out=new Uint8Array(4);new DataView(out.buffer).setFloat32(0,value,true);return cat(varint((field<<3)|5),out);};
const vehicleFixture=({id,route='29',timestamp})=>bytes(2,cat(
 string(1,`entity-${id}`),
 bytes(4,cat(
  bytes(1,cat(string(1,`trip-${route}`),string(5,route))),
  bytes(2,cat(f32(1,43.65),f32(2,-79.44))),
  scalar(5,timestamp),
  bytes(8,cat(string(1,id),string(2,id))),
 )),
));
const vehicleFeed=(timestamp,...vehicles)=>cat(bytes(1,cat(string(1,'2.0'),scalar(3,timestamp))),...vehicles);
test('Journey proxy attaches division evidence only after real exact-trip enrichment', {timeout:10000}, async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'gtha-journey-division-')),fixture=path.join(root,'vehicles.pb');
 const now=Date.now(),timestamp=Math.floor(now/1000);writeFileSync(fixture,vehicleFeed(timestamp,vehicleFixture({id:'7001',route:'29',timestamp})));
 const routing=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({itineraries:[{id:'trip',legs:[{mode:'BUS',agencyFeedId:'ttc',routeId:'ttc:29',tripId:'ttc:trip-29',startTime:new Date(now+600000).toISOString(),endTime:new Date(now+1800000).toISOString()}]}]}));});
 await new Promise(resolve=>routing.listen(0,'127.0.0.1',resolve));
 const probe=http.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const child=spawn(process.execPath,['server/web.mjs'],{env:{...process.env,PORT:String(port),HOST:'127.0.0.1',ROUTING_ORIGIN:`http://127.0.0.1:${routing.address().port}`,VEHICLE_FIXTURE_PATH:fixture}});let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
 try{
  for(let i=0;i<50&&!log.includes('ready');i++)await pause(50);assert.match(log,/ready/);
  for(const key of ['fixturePath','routingOrigin','now','fetchImpl']) {
   const rejected=await fetch(`http://127.0.0.1:${port}/api/vehicles?${key}=untrusted`);
   assert.equal(rejected.status,400);assert.equal((await rejected.json()).code,'INVALID_VEHICLE_QUERY');
  }
  const response=await fetch(`http://127.0.0.1:${port}/api/plan`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});assert.equal(response.status,200);
  const payload=await response.json(),leg=payload.itineraries[0].legs[0];
  assert.deepEqual(leg.vehicleAssignment,{state:'matched',method:'exact-trip-id'});assert.equal(leg.vehicle.id,'7001');
  assert.ok(['out-of-division','in-division','unknown'].includes(leg.vehicleDivision.state));assert.equal(leg.vehicleDivision.vehicleId,'7001');
  assert.equal(leg.vehicleDivision.routeId,'29');assert.ok(Number.isFinite(leg.vehicleDivision.checkedAt));assert.ok(Number.isFinite(leg.vehicleDivision.validUntil));assert.ok(payload.divisionEvidence);
  assert.equal(leg.routeDivisionOpportunity.routeId,'29');
  assert.ok(['observed','unknown'].includes(leg.routeDivisionOpportunity.state));
  assert.equal(leg.routeDivisionOpportunity.lat,undefined);
 }finally{child.kill();await once(child,'exit');await new Promise(resolve=>routing.close(resolve));rmSync(root,{recursive:true,force:true});}
});
test('Washroom detour POST reaches the routing origin with its exact body', {timeout:10000}, async()=>{
 const received=[];
 const routing=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;received.push({method:req.method,url:req.url,body:JSON.parse(raw)});res.setHeader('content-type','application/json');res.end(JSON.stringify({status:'facility-only',completeJourney:false,facility:{name:'Verified facility',availability:'confirmed-open'},continuation:null}));});
 await new Promise(resolve=>routing.listen(0,'127.0.0.1',resolve));
 const probe=http.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 const child=spawn(process.execPath,['server/web.mjs'],{env:{...process.env,PORT:String(port),HOST:'127.0.0.1',ROUTING_ORIGIN:`http://127.0.0.1:${routing.address().port}`}});let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
 try{
  for(let i=0;i<50&&!log.includes('ready');i++)await pause(50);assert.match(log,/ready/);
  const body={currentPosition:{lat:43.67,lon:-79.38},dateTime:'2026-09-05T12:00:00-04:00',facilityOnly:true,visitMinutes:10};
  const response=await fetch(`http://127.0.0.1:${port}/api/plan-washroom-detour`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  assert.equal(response.status,200);assert.equal((await response.json()).status,'facility-only');assert.deepEqual(received,[{method:'POST',url:'/api/plan-washroom-detour',body}]);
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/plan-washroom-detour`)).status,405);assert.equal(received.length,1);
 }finally{child.kill();await once(child,'exit');await new Promise(resolve=>routing.close(resolve));}
});
test('Real HTTP server serves provenance and isolates private backend failures',{timeout:10000},async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'gtha-web-'));writeFileSync(path.join(root,'index.html'),'<!doctype html><title>GTHA</title>');const child=spawn(process.execPath,['server/web.mjs'],{env:{...process.env,PORT:'18784',HOST:'127.0.0.1',STATIC_ROOT:root,ROUTING_ORIGIN:'http://127.0.0.1:1'}});let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
 try{for(let i=0;i<50&&!log.includes('ready');i++)await pause(50);assert.match(log,/ready/);const health=await fetch('http://127.0.0.1:18784/health');assert.equal(health.status,200);const csp=new Map(health.headers.get('content-security-policy').split(';').map(rule=>{const words=rule.trim().split(' ').filter(Boolean);return [words.shift(),words];}));assert.deepEqual(csp.get('script-src'),["'self'","'unsafe-inline'"]);assert.deepEqual(csp.get('connect-src'),["'self'"]);assert.deepEqual(csp.get('worker-src'),["'self'"]);assert.deepEqual(csp.get('font-src'),["'self'","data:"]);assert.equal((await health.json()).ok,true);const api=await fetch('http://127.0.0.1:18784/api/coverage');assert.equal(api.status,503);const output=await api.text();assert.equal(output.includes('127.0.0.1'),false);assert.equal(api.headers.get('referrer-policy'),'no-referrer');const page=await fetch('http://127.0.0.1:18784/');assert.equal(page.status,200);assert.ok(page.headers.get('cache-control').split(',').includes('no-transform'));assert.match(await page.text(),/GTHA/);}
 finally{child.kill();await once(child,'exit');rmSync(root,{recursive:true,force:true});}
});

test('Vehicle division endpoint paginates annotated TTC records and reports pre-filter counts', {timeout:10000}, async()=>{
 const root=mkdtempSync(path.join(tmpdir(),'gtha-web-')),history=mkdtempSync(path.join(tmpdir(),'gtha-history-')),fixture=path.join(root,'vehicles.pb');writeFileSync(path.join(root,'index.html'),'<!doctype html><title>GTHA</title>');const now=Math.floor(Date.now()/1000);writeFileSync(fixture,vehicleFeed(now,vehicleFixture({id:'7001',timestamp:now}),vehicleFixture({id:'9001',timestamp:now})));const probe=http.createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));const child=spawn(process.execPath,['server/web.mjs'],{env:{...process.env,PORT:String(port),HOST:'127.0.0.1',STATIC_ROOT:root,HISTORY_DIR:history,VEHICLE_FIXTURE_PATH:fixture,ROUTING_ORIGIN:'http://127.0.0.1:1'}});let log='';child.stdout.on('data',data=>log+=data);child.stderr.on('data',data=>log+=data);
 try{for(let attempt=0;attempt<50&&!log.includes('ready');attempt+=1)await pause(50);assert.match(log,/ready/);const response=await fetch(`http://127.0.0.1:${port}/api/vehicles/divisions?route=29&limit=1`);assert.equal(response.status,200);const payload=await response.json();assert.equal(payload.total,2);assert.equal(payload.counts.all,2);assert.equal(payload.vehicles.length,1);assert.ok(payload.nextCursor);assert.equal(payload.source.sha256,'5A81E7680049BDFADDD9187C1867AE966939B0E5D35085E4EF583D77CEE1466C');assert.deepEqual(payload.vehicles[0].division.routeGarages,['MtD']);assert.equal(payload.vehicles[0].division.rarity.state,'available');const invalid=await fetch(`http://127.0.0.1:${port}/api/vehicles/divisions?classification=made-up`);assert.equal(invalid.status,400);}
 finally{child.kill();await once(child,'exit');rmSync(root,{recursive:true,force:true});rmSync(history,{recursive:true,force:true});}
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

test('Place proxy ranks a compact-query local intersection before a capped stop list and retains a healthy source', {timeout: 10000}, async () => {
 let routingAvailable = true;
 const routing = http.createServer((req, res) => {
  if (!req.url.startsWith('/api/places')) return res.writeHead(404).end();
  if (!routingAvailable) return res.writeHead(503).end();
  const places = Array.from({ length: 20 }, (_, index) => ({ id: `routing:${index}`, name: `Union Station ${index}`, kind: 'stop' }));
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ places }));
 });
 const maps = http.createServer((req, res) => {
  if (!req.url.startsWith('/search')) return res.writeHead(404).end();
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ results: [
   { id: 'map:warden-hwy7', name: 'Warden Avenue & Highway 7', kind: 'intersection', lat: null, lon: null },
   { id: 'routing:0', name: 'Union Station 0', kind: 'stop', lat: null, lon: null },
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
  const full = await fetch(`http://127.0.0.1:${port}/api/places?q=Highway7Warden`);
  assert.equal(full.status, 200);
  const fullPayload = await full.json();
  assert.equal(fullPayload.partial, false);
  assert.deepEqual(fullPayload.sources, { routing: 'available', maps: 'available' });
  assert.equal(fullPayload.places[0].id, 'map:warden-hwy7');
  assert.equal(fullPayload.places.filter((place) => place.id === 'routing:0').length, 1);
  assert.equal(fullPayload.places.length, 21);
  routingAvailable = false;
  const partial = await fetch(`http://127.0.0.1:${port}/api/places?q=Highway7Warden`);
  assert.equal(partial.status, 200);
  const partialPayload = await partial.json();
  assert.equal(partialPayload.partial, true);
  assert.deepEqual(partialPayload.sources, { routing: 'unavailable', maps: 'available' });
  assert.deepEqual(partialPayload.places.map((place) => place.id), ['map:warden-hwy7', 'routing:0']);
 } finally {
  child.kill();
  await once(child, 'exit');
  await new Promise((resolve) => routing.close(resolve));
  await new Promise((resolve) => maps.close(resolve));
 }
});
