import {cpSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const root='dist/release';mkdirSync(root,{recursive:true});
for(const dir of ['server','status','history','realtime','vehicles'])cpSync(dir,`${root}/${dir}`,{recursive:true,filter:p=>!p.endsWith('.test.mjs')&&!p.includes('fixtures')});
cpSync('dist/client',`${root}/dist/client`,{recursive:true});
writeFileSync(`${root}/package.json`,JSON.stringify({name:'gtha-transit-web',version:JSON.parse(readFileSync('package.json')).version,type:'module',scripts:{start:'node server/web.mjs'},engines:{node:'>=24.19.0'}},null,2));
cpSync('docs/deployment/README.md',`${root}/DEPLOYMENT.md`);
execFileSync('tar',['-czf','dist/gtha-transit-web.tar.gz','-C',root,'.'],{stdio:'inherit'});
console.log('Created dist/gtha-transit-web.tar.gz from the current static build.');
