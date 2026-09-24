// Local, in-memory UI QA. This server never calls Meta or the Oflan API.
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handle,DATASET} from '../lib/bomflan.js';
const sqlite=new DatabaseSync(':memory:');
sqlite.exec(readFileSync(new URL('../migrations/0001_bomflan.sql',import.meta.url),'utf8'));
const db={prepare(sql){return {bind(...args){const s=sqlite.prepare(sql);return {async first(){return s.get(...args)||null;},async all(){return {results:s.all(...args)};},async run(){return s.run(...args);}};}};}};
const env={BOMFLAN_DB:db,BOMFLAN_ADMIN_USER:'local',BOMFLAN_ADMIN_PASSWORD:'local-preview-only',BOMFLAN_DATASET_ID:DATASET,BOMFLAN_DATASET_VERIFIED:DATASET,BOMFLAN_META_TOKEN:'not-a-real-token',BOMFLAN_GRAPH_VERSION:'v25.0',BOMFLAN_ACTION_SOURCE:'chat',BOMFLAN_TEST_EVENT_CODE:'LOCAL_ONLY',BOMFLAN_LIVE_ENABLED:'false'};
const attempts=new Map();
const simulatedMeta=async(url,options)=>{
  const event=JSON.parse(options.body).data[0];
  const count=(attempts.get(event.event_id)||0)+1;attempts.set(event.event_id,count);
  // Rp1 intentionally simulates a first-attempt timeout for retry QA.
  if(event.custom_data.value===1 && count===1)throw Error('simulated timeout');
  return Response.json({events_received:1,fbtrace_id:'LOCAL-SIMULATION'});
};
createServer(async(req,res)=>{
  try{
    if(!req.url.startsWith('/bom-flan')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end('<h1>Pratinjau lokal</h1><p>Backend Oflan tidak dihubungkan pada simulasi ini.</p><a href="/bom-flan/">Buka Bom Flan</a>');return;}
    const chunks=[];for await(const c of req)chunks.push(c);
    const request=new Request('http://127.0.0.1:8789'+req.url,{method:req.method,headers:{...req.headers,Authorization:'Basic '+btoa('local:local-preview-only')},body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
    const result=await handle(request,env,simulatedMeta);res.writeHead(result.status,Object.fromEntries(result.headers));
    let body=await result.text();if(result.headers.get('Content-Type')?.includes('text/html'))body=body.replace('<body>','<body><p class="notice"><b>PRATINJAU LOKAL — SIMULASI.</b> Tidak ada event dikirim ke Meta. Nilai Rp1 mensimulasikan kegagalan pertama untuk menguji resend.</p>');res.end(body);
  }catch{res.writeHead(500);res.end('Local preview error');}
}).listen(8789,'127.0.0.1',()=>console.log('Local simulation: http://127.0.0.1:8789/bom-flan/'));
