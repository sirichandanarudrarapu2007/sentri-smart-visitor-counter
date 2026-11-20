import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicRoot = path.join(root, 'src');
const dataPath = path.join(root, 'local', 'sentri-data.json');
const port = Number(process.env.PORT || 4173);
const seed = () => ({ inside:24, total:186, peak:42, capacity:80, logs:[
  {id:'EVT-00841',time:'10:42:18 AM',type:'IN',source:'Front entrance'},
  {id:'EVT-00840',time:'10:39:52 AM',type:'OUT',source:'Front entrance'},
  {id:'EVT-00839',time:'10:35:07 AM',type:'IN',source:'Front entrance'},
  {id:'EVT-00838',time:'10:31:44 AM',type:'IN',source:'Front entrance'},
  {id:'EVT-00837',time:'10:28:13 AM',type:'OUT',source:'Front entrance'}
]});
async function readState() {
  try { return JSON.parse(await fs.readFile(dataPath,'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; const initial=seed(); await writeState(initial); return initial; }
}
async function writeState(state) { await fs.mkdir(path.dirname(dataPath),{recursive:true}); await fs.writeFile(dataPath,JSON.stringify(state,null,2)); }
function send(res,status,body) { res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}); res.end(JSON.stringify(body)); }
async function bodyOf(req) { let raw=''; for await (const chunk of req) { raw+=chunk; if(raw.length>16384) throw new Error('Request body too large'); } return raw ? JSON.parse(raw) : {}; }
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/api/health'&&req.method==='GET') return send(res,200,{ok:true,mode:'local-demo',storage:'local-json'});
    if(url.pathname==='/api/state'&&req.method==='GET') return send(res,200,await readState());
    if(url.pathname==='/api/events'&&req.method==='GET') { const s=await readState(); return send(res,200,{events:s.logs}); }
    if(url.pathname==='/api/events'&&req.method==='POST') {
      const input=await bodyOf(req); if(!['IN','OUT'].includes(input.type)) return send(res,400,{message:'Event type must be IN or OUT.'});
      const s=await readState();
      if(input.type==='OUT'&&s.inside<=0) return send(res,409,{message:'The space is already empty.'});
      if(input.type==='IN'&&s.inside>=s.capacity) return send(res,409,{message:'Capacity reached. No more entries can be recorded.'});
      s.inside+=input.type==='IN'?1:-1; if(input.type==='IN'){s.total+=1;s.peak=Math.max(s.peak,s.inside);}
      const now=new Date(); s.logs.unshift({id:`EVT-${randomUUID().slice(0,8).toUpperCase()}`,time:now.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',second:'2-digit'}),type:input.type,source:String(input.source||'Front entrance').slice(0,80)});
      s.logs=s.logs.slice(0,500); await writeState(s); return send(res,201,{state:s});
    }
    if(url.pathname==='/api/settings'&&req.method==='PUT') {
      const input=await bodyOf(req); const capacity=Number(input.capacity);
      if(!Number.isInteger(capacity)||capacity<1||capacity>100000) return send(res,400,{message:'Capacity must be a whole number from 1 to 100000.'});
      const s=await readState(); s.capacity=capacity; await writeState(s); return send(res,200,s);
    }
    if(url.pathname==='/api/demo/reset'&&req.method==='POST') { const s=seed(); await writeState(s); return send(res,200,s); }
    if(req.method!=='GET'&&req.method!=='HEAD') return send(res,405,{message:'Method not allowed.'});
    const requested=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
    const file=path.resolve(publicRoot,`.${requested}`);
    if(!file.startsWith(publicRoot+path.sep)) return send(res,403,{message:'Forbidden.'});
    const content=await fs.readFile(file); res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-cache'}); if(req.method==='HEAD') return res.end(); res.end(content);
  } catch(error) { console.error(error); send(res,500,{message:'Sentri server error.'}); }
});
server.listen(port,()=>console.log(`Sentri local demo: http://localhost:${port}`));
