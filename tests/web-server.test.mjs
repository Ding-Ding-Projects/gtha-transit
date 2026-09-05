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
