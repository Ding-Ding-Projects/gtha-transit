// The upstream CLI exits immediately after success. Let native bundler handles
// finish closing before its final Windows process exit. Nonzero exits are unchanged.
const exit=process.exit.bind(process);
process.exit=(code)=>{if(code===0){setTimeout(()=>exit(0),1000);return;}exit(code);};
process.argv=[process.execPath,'vinext','build'];
await import(new URL('../node_modules/vinext/dist/cli.js',import.meta.url).href);
