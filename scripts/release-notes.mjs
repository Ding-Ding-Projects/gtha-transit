import {readFileSync,writeFileSync} from 'node:fs';
const start=readFileSync('/tmp/workflow-started','utf8').trim(),finish=new Date().toISOString(),seconds=Math.floor((Date.parse(finish)-Date.parse(start))/1000);const duration=[Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(x=>String(x).padStart(2,'0')).join(':');
const sha=process.env.GITHUB_SHA;
// The dim sum code name is a label beside the version, never a replacement for it,
// and it must never block a release. When the picker could not resolve an unused
// dish with a published photo, the release ships with its version alone and says so.
let codeName='';
try{
  const dish=JSON.parse(readFileSync('dist/dim-sum.json','utf8'));
  if(dish&&dish.name&&dish.photoUrl){
    codeName=`Code name: ${dish.name}\n\n[${dish.alt||dish.name}](${dish.photoUrl}) - photo published in the [public dim sum catalog](https://github.com/Ding-Ding-Projects/dim-sum-photos), attached to this release as \`${dish.file}\`.\n\n`;
  }
}catch{codeName='';}

writeFileSync('dist/release-notes.md',`# GTHA Transit ${process.env.TAG}\n\n${codeName}A standalone web server bundle built from [${sha}](https://github.com/Ding-Ding-Projects/gtha-transit/commit/${sha}). It requires Node.js 24.19.0 and separately configured routing and map services. Run npm start after extraction.\n\nThis workflow built and packaged the frontend. It ran no tests, lint, runtime interaction, or deployment checks. Public DNS is configured separately by the owner. Availability of an archive does not certify eleven-agency coverage or a public deployment.\n\nBuild started: ${start}\nPackage completed: ${finish}\nBuild and packaging duration: ${duration}\n\nFinal publication timing is available in the workflow run; the timestamps above stop before publication.\n\n${readFileSync('dist/line-counts.md','utf8')}\n\n## 廣東話\n\n呢個獨立網頁服務套件由上面列明嘅提交建置，需要 Node.js 24.19.0 及另外設定嘅路線同地圖服務。解壓後執行 npm start。流程只建置同打包，無執行測試或部署驗證。公開 DNS 由擁有人另外設定。\n`);
