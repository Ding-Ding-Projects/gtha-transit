import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as pause} from 'node:timers/promises';
test('Real HTTP server serves provenance and isolates private backend failures',{timeout:10000},async()=>{
 const child=spawn(process.execPath,['server/web.mjs'],{env:{...process.env,PORT:'18784',HOST:'127.0.0.1',ROUTING_ORIGIN:'http://127.0.0.1:1'}});let log='';child.stdout.on('data',d=>log+=d);child.stderr.on('data',d=>log+=d);
 try{for(let i=0;i<50&&!log.includes('ready');i++)await pause(50);assert.match(log,/ready/);const health=await fetch('http://127.0.0.1:18784/health');assert.equal(health.status,200);assert.equal((await health.json()).ok,true);const api=await fetch('http://127.0.0.1:18784/api/coverage');assert.equal(api.status,503);const output=await api.text();assert.equal(output.includes('127.0.0.1'),false);assert.equal(api.headers.get('referrer-policy'),'no-referrer');const page=await fetch('http://127.0.0.1:18784/');assert.equal(page.status,200);assert.match(await page.text(),/GTHA/);}
 finally{child.kill();await once(child,'exit');}
});
