import { html } from './bomflan-ui.js';

export const DATASET = '1626416872401155';
const headers = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const json = (data, status=200) => new Response(JSON.stringify(data), {status,headers:{...headers,'Content-Type':'application/json'}});
export const dayJakarta = (ms=Date.now()) => new Date(ms+7*3600000).toISOString().slice(0,10);
export async function hash(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join('');
}
export function phoneNormalize(raw) {
  let p=String(raw??'').trim();
  if(!/^[+\d\s().-]+$/.test(p)) throw new Error('Nomor telepon tidak valid.');
  p=p.replace(/[^\d+]/g,'');
  if(p.startsWith('+')) p=p.slice(1);
  else if(p.startsWith('00')) p=p.slice(2);
  else if(p.startsWith('0')) p='62'+p.slice(1);
  else if(p.startsWith('8')) p='62'+p;
  if(!/^[1-9]\d{7,14}$/.test(p)) throw new Error('Gunakan nomor lengkap dengan kode negara.');
  return p;
}
async function authorized(request,env) {
  if(!env.BOMFLAN_ADMIN_USER || !env.BOMFLAN_ADMIN_PASSWORD) return false;
  const auth=request.headers.get('Authorization')||'';
  if(!auth.startsWith('Basic ')) return false;
  let value;try{value=new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(auth.slice(6)),c=>c.charCodeAt(0)));}catch{return false;}
  const a=await hash(value),b=await hash(`${env.BOMFLAN_ADMIN_USER}:${env.BOMFLAN_ADMIN_PASSWORD}`);
  let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
function settings(env,mode) {
  if(env.BOMFLAN_DATASET_ID!==DATASET || env.BOMFLAN_DATASET_VERIFIED!==DATASET) throw new Error('Dataset Bom Flan belum diverifikasi.');
  if(!env.BOMFLAN_META_TOKEN || !/^v\d+\.0$/.test(env.BOMFLAN_GRAPH_VERSION||'')) throw new Error('Koneksi Meta belum lengkap.');
  if(!['chat','business_messaging'].includes(env.BOMFLAN_ACTION_SOURCE)) throw new Error('Sumber pembelian belum dikonfigurasi.');
  if(mode==='live' && env.BOMFLAN_LIVE_ENABLED!=='true') throw new Error('Mode produksi belum diaktifkan.');
  if(mode==='test' && !env.BOMFLAN_TEST_EVENT_CODE) throw new Error('Kode Test Events belum dipasang.');
  if(env.BOMFLAN_ACTION_SOURCE==='business_messaging' && !/^\d+$/.test(env.BOMFLAN_WABA_ID||'')) throw new Error('Identitas WhatsApp Bom Flan belum lengkap.');
}
export async function makeEvent(body,env,mode,now=Date.now()) {
  if(body.paid_confirmed!==true) throw new Error('Konfirmasi pembayaran diterima diperlukan.');
  const order=String(body.order_id||'');
  const prefix=mode==='test'?'BF-TEST-':'BF-';
  if(!order.startsWith(prefix) || (mode==='live' && order.startsWith('BF-TEST-')) || !/^BF-[A-Za-z0-9-]{1,64}$/.test(order)) throw new Error('Order ID harus memakai prefix Bom Flan yang sesuai.');
  if(typeof body.value!=='number' || !Number.isSafeInteger(body.value) || body.value<=0 || body.value>1000000000) throw new Error('Nilai rupiah harus bilangan bulat positif, maksimal Rp1 miliar.');
  const phone=phoneNormalize(body.phone);
  const user_data={ph:[await hash(phone)]};
  const event={event_name:'Purchase',event_id:`bomflan:${mode}:${order}`,event_time:Math.floor(now/1000),action_source:env.BOMFLAN_ACTION_SOURCE,user_data,custom_data:{order_id:order,value:body.value,currency:'IDR'}};
  if(env.BOMFLAN_ACTION_SOURCE==='business_messaging') {
    if(typeof body.ctwa_clid!=='string' || !/^[A-Za-z0-9_-]{10,2048}$/.test(body.ctwa_clid)) throw new Error('Click ID WhatsApp asli diperlukan untuk pembelian dari iklan.');
    event.messaging_channel='whatsapp';
    user_data.ctwa_clid=body.ctwa_clid;
    user_data.whatsapp_business_account_id=env.BOMFLAN_WABA_ID;
  }
  // The submitting admin's IP and user-agent are deliberately not customer identifiers.
  return {event,phone,order};
}
export async function deliver(db,env,mode,order,send=fetch,now=Date.now()) {
  settings(env,mode);
  const token=crypto.randomUUID();
  const row=await db.prepare(`UPDATE bf_orders SET status='SENDING',lease_until=?,lease_token=?,attempts=attempts+1
    WHERE mode=? AND order_id=? AND dataset_id=? AND status!='SUCCESS' AND lease_until<=? RETURNING *`)
    .bind(now+120000,token,mode,order,DATASET,now).first();
  if(!row) {
    const current=await db.prepare('SELECT status FROM bf_orders WHERE mode=? AND order_id=?').bind(mode,order).first();
    return {status:current?.status||'NOT_FOUND'};
  }
  let result={message:'Pengiriman gagal.'},ok=false;
  const payload={data:[JSON.parse(row.payload)]};
  if(mode==='test') payload.test_event_code=env.BOMFLAN_TEST_EVENT_CODE;
  if(now/1000-row.event_time>7*86400) result={message:'Event lebih dari 7 hari. Perlu pemeriksaan manual; waktu pembelian tidak diubah.'};
  else try {
    const res=await send(`https://graph.facebook.com/${env.BOMFLAN_GRAPH_VERSION}/${row.dataset_id}/events`,{
      method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${env.BOMFLAN_META_TOKEN}`},
      body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)
    });
    const data=await res.json();
    ok=res.ok && data.events_received===1;
    // Do not persist arbitrary upstream messages that could echo customer data or credentials.
    result={events_received:data.events_received===1?1:0,http_status:res.status,code:Number(data.error?.code)||null,subcode:Number(data.error?.error_subcode)||null,fbtrace_id:typeof data.fbtrace_id==='string'?data.fbtrace_id.slice(0,100):null};
  } catch {result={message:'Koneksi terputus atau timeout. Resend memakai event yang sama.'};}
  const status=ok?'SUCCESS':'FAILED';
  await db.prepare('UPDATE bf_orders SET status=?,lease_until=0,lease_token=NULL,last_sent_at=?,result=? WHERE mode=? AND order_id=? AND lease_token=?')
    .bind(status,new Date(now).toISOString(),JSON.stringify(result),mode,order,token).run();
  return {status,result};
}
export async function handle(request,env,send=fetch) {
  if(!env.BOMFLAN_ADMIN_USER || !env.BOMFLAN_ADMIN_PASSWORD) return json({message:'Admin Bom Flan belum dikonfigurasi.'},503);
  if(!await authorized(request,env)) return new Response('Login admin Bom Flan diperlukan.',{status:401,headers:{...headers,'WWW-Authenticate':'Basic realm="Bom Flan Admin", charset="UTF-8"'}});
  const url=new URL(request.url),path=url.pathname.replace(/\/$/,'');
  if(path==='/bom-flan' && request.method==='GET') return new Response(html,{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"}});
  const mode=url.searchParams.get('mode');
  if(!['test','live'].includes(mode))return json({message:'Mode harus test atau live.'},400);
  if(!env.BOMFLAN_DB)return json({message:'Penyimpanan Bom Flan belum dikonfigurasi.'},503);
  const db=env.BOMFLAN_DB.withSession ? env.BOMFLAN_DB.withSession('first-primary') : env.BOMFLAN_DB;
  if(request.method==='GET' && path==='/bom-flan/config') {
    let ready=true,message='';try{settings(env,mode);}catch(e){ready=false;message=e.message;}
    return json({ready,message,mode,action_source:env.BOMFLAN_ACTION_SOURCE,dataset_id:DATASET});
  }
  if(request.method==='GET' && path==='/bom-flan/history-today') {
    try {
      const rows=await db.prepare('SELECT order_id,phone,value,event_time,event_id,dataset_id,status,attempts,last_sent_at,result FROM bf_orders WHERE mode=? AND day=? ORDER BY event_time DESC,order_id DESC').bind(mode,dayJakarta()).all();
      return json({orders:rows.results,date:dayJakarta()});
    } catch{return json({message:'Riwayat belum dapat dibaca.'},503);}
  }
  if(request.method!=='POST')return json({message:'Tidak ditemukan.'},404);
  if(request.headers.get('Origin')!==url.origin || !request.headers.get('Content-Type')?.startsWith('application/json'))return json({message:'Permintaan harus berasal dari halaman admin ini.'},403);
  if(!['/bom-flan/reserve-order-id','/bom-flan/mark-paid','/bom-flan/resend-meta'].includes(path))return json({message:'Tidak ditemukan.'},404);
  try{settings(env,mode);}catch(e){return json({message:e.message},503);}
  let body;
  try{const raw=await request.text();if(raw.length>8192)throw 0;body=JSON.parse(raw);if(!body || typeof body!=='object' || Array.isArray(body))throw 0;}catch{return json({message:'Data permintaan tidak valid.'},400);}
  if(body.brand && body.brand!=='bomflan')return json({message:'Brand tidak sesuai.'},400);
  try {
    if(path==='/bom-flan/reserve-order-id') {
      const day=dayJakarta();
      const row=await db.prepare('INSERT INTO bf_sequences(mode,day,seq) VALUES(?,?,1) ON CONFLICT(mode,day) DO UPDATE SET seq=seq+1 RETURNING seq').bind(mode,day).first();
      return json({order_id:`BF-${mode==='test'?'TEST-':''}${day.replaceAll('-','').slice(2)}-${String(row.seq).padStart(4,'0')}`});
    }
    if(path==='/bom-flan/mark-paid') {
      let made;try{made=await makeEvent(body,env,mode);}catch(e){return json({message:e.message},400);}
      const {event,phone,order}=made;
      await db.prepare(`INSERT INTO bf_orders(mode,order_id,phone,value,day,event_time,event_id,dataset_id,payload,status)
        VALUES(?,?,?,?,?,?,?,?,?,'PENDING') ON CONFLICT(mode,order_id) DO NOTHING`)
        .bind(mode,order,phone,body.value,dayJakarta(),event.event_time,event.event_id,DATASET,JSON.stringify(event)).run();
      const stored=await db.prepare('SELECT * FROM bf_orders WHERE mode=? AND order_id=?').bind(mode,order).first();
      const original=JSON.parse(stored.payload);
      if(stored.phone!==phone || stored.value!==body.value || (original.user_data.ctwa_clid||'')!==(event.user_data.ctwa_clid||''))return json({message:'Order ID sudah tersimpan dengan data berbeda. Periksa order; jangan membuat pembelian duplikat.'},409);
      return json({order_id:order,...await deliver(db,env,mode,order,send)});
    }
    if(typeof body.order_id!=='string')return json({message:'Order ID diperlukan.'},400);
    const result=await deliver(db,env,mode,body.order_id,send);
    return json(result,result.status==='NOT_FOUND'?404:200);
  } catch {return json({message:'Permintaan belum selesai. Periksa History lalu gunakan Order ID yang sama saat mencoba lagi.'},503);}
}
