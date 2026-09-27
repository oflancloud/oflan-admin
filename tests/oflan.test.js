import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handle,deliver,hash,phoneNormalize,dayJakarta} from '../lib/oflan.js';
const DATASET='123456789012345';

function fixture(){
  const sqlite=new DatabaseSync(':memory:');sqlite.exec(readFileSync(new URL('../migrations/0002_oflan.sql',import.meta.url),'utf8'));
  const db={prepare(sql){return {bind(...args){const s=sqlite.prepare(sql);return {async first(){return s.get(...args)||null;},async all(){return {results:s.all(...args)};},async run(){return s.run(...args);}};}};}};
  const env={OFLAN_DB:db,BOMFLAN_ADMIN_USER:'admin',BOMFLAN_ADMIN_PASSWORD:'test-only-password',OFLAN_DATASET_ID:DATASET,OFLAN_DATASET_VERIFIED:DATASET,OFLAN_GRAPH_VERSION:'v25.0',OFLAN_META_TOKEN:'test-only-token',OFLAN_ACTION_SOURCE:'chat',OFLAN_TEST_EVENT_CODE:'TEST123',OFLAN_LIVE_ENABLED:'true'};
  const calls=[];const send=async(url,opts)=>{calls.push({url,opts,payload:JSON.parse(opts.body)});return Response.json({events_received:1,fbtrace_id:'test-trace'});};
  const req=(path,body,mode='test',auth=true,origin='https://admin.oflan.id')=>new Request('https://admin.oflan.id/oflan/'+path+'?mode='+mode,{method:body?'POST':'GET',headers:{...(auth?{Authorization:'Basic '+btoa('admin:test-only-password')}:{}),Origin:origin,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const body={order_id:'OF-TEST-260922-0001',phone:'0812 3456 7890',value:109000,paid_confirmed:true};
  return {db,env,calls,send,req,body,sqlite};
}
test('normalization, hash and Jakarta midnight',async()=>{
  for(const p of ['0812-3456-7890','+62 81234567890','6281234567890','81234567890'])assert.equal(phoneNormalize(p),'6281234567890');
  assert.equal(phoneNormalize('+14155552671'),'14155552671');
  for(const p of ['hello','12','+62+81','123 ext 4'])assert.throws(()=>phoneNormalize(p));
  assert.equal((await hash('6281234567890')).length,64);
  assert.equal(dayJakarta(Date.parse('2026-09-22T16:59:59Z')),'2026-09-22');
  assert.equal(dayJakarta(Date.parse('2026-09-22T17:00:00Z')),'2026-09-23');
});
test('unauthenticated, cross-origin, unconfirmed and wrong brand cannot write',async()=>{
  const f=fixture();
  for(const [r,status] of [[f.req('history-today',null,'test',false),401],[f.req('mark-paid',f.body,'test',true,'https://evil.example'),403],[f.req('mark-paid',{...f.body,paid_confirmed:false}),400],[f.req('mark-paid',{...f.body,brand:'bomflan'}),400]])assert.equal((await handle(r,f.env,f.send)).status,status);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM of_orders').get().n,0);assert.equal(f.calls.length,0);
});
test('test Purchase targets only Oflan, excludes admin identity and stays idempotent',async()=>{
  const f=fixture();
  for(let i=0;i<2;i++)assert.equal((await (await handle(f.req('mark-paid',f.body),f.env,f.send)).json()).status,'SUCCESS');
  assert.equal(f.calls.length,1);const c=f.calls[0];assert.equal(c.url,`https://graph.facebook.com/v25.0/${DATASET}/events`);
  assert.equal(c.payload.test_event_code,'TEST123');const e=c.payload.data[0];assert.equal(e.event_name,'Purchase');assert.equal(e.event_id,'oflan:test:'+f.body.order_id);assert.equal(e.custom_data.currency,'IDR');assert.equal(e.custom_data.value,109000);assert.equal(e.custom_data.order_id,f.body.order_id);assert.deepEqual(e.user_data,{ph:[await hash('6281234567890')]});
  const conflict=await handle(f.req('mark-paid',{...f.body,value:69000}),f.env,f.send);assert.equal(conflict.status,409);assert.equal(f.calls.length,1);
});
test('retry persists exact payload, event_id, event_time and destination after timeout',async()=>{
  const f=fixture();await handle(f.req('mark-paid',f.body),f.env,async()=>{throw new Error('secret should not leak');});
  const old=f.sqlite.prepare('SELECT * FROM of_orders').get();assert.equal(old.status,'FAILED');
  await deliver(f.db,f.env,'test',f.body.order_id,f.send,Date.now()+60000);
  const after=f.sqlite.prepare('SELECT * FROM of_orders').get();assert.equal(after.status,'SUCCESS');assert.equal(after.attempts,2);assert.deepEqual(f.calls[0].payload.data[0],JSON.parse(old.payload));assert.equal(after.payload,old.payload);assert.ok(!after.result.includes('secret'));
});
test('in-flight duplicate delivery is blocked by database lease',async()=>{
  const f=fixture();let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);let sends=0;
  const p=handle(f.req('mark-paid',f.body),f.env,async()=>{sends++;entered();await gate;return Response.json({events_received:1});});
  await started;const duplicate=await deliver(f.db,f.env,'test',f.body.order_id,f.send);assert.equal(duplicate.status,'SENDING');assert.equal(f.calls.length,0);release();await p;assert.equal(sends,1);
});
test('expired sending lease is recoverable with original payload',async()=>{
  const f=fixture();await handle(f.req('mark-paid',f.body),f.env,async()=>{throw 0;});
  f.sqlite.prepare("UPDATE of_orders SET status='SENDING',lease_until=?,lease_token='old'").run(Date.now()-1);
  assert.equal((await deliver(f.db,f.env,'test',f.body.order_id,f.send)).status,'SUCCESS');
});
test('production and test storage and sequence are separate; no Oflan fallback',async()=>{
  const f=fixture();
  const ids=await Promise.all(Array.from({length:10},()=>handle(f.req('reserve-order-id',{}),f.env,f.send).then(r=>r.json())));assert.equal(new Set(ids.map(v=>v.order_id)).size,10);
  const live=await (await handle(f.req('reserve-order-id',{},'live'),f.env,f.send)).json();assert.ok(live.order_id.endsWith('-0001'));assert.ok(!live.order_id.includes('TEST'));
  await handle(f.req('mark-paid',f.body),f.env,f.send);
  assert.equal((await (await handle(f.req('history-today',null,'live'),f.env,f.send)).json()).orders.length,0);
  assert.equal((await handle(f.req('resend-meta',{order_id:f.body.order_id},'live'),f.env,f.send)).status,404);
  const bad={...f.env,OFLAN_DATASET_ID:'oflan',META_PIXEL_ID:'oflan',META_ACCESS_TOKEN:'oflan'};
  assert.equal((await handle(f.req('mark-paid',f.body),bad,f.send)).status,503);
});
test('live disabled and missing test config fail closed before persistence',async()=>{
  const f=fixture();
  assert.equal((await handle(f.req('mark-paid',{...f.body,order_id:'OF-260922-0001'},'live'),{...f.env,OFLAN_LIVE_ENABLED:'false'},f.send)).status,503);
  assert.equal((await handle(f.req('mark-paid',f.body),{...f.env,OFLAN_TEST_EVENT_CODE:''},f.send)).status,503);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM of_orders').get().n,0);
});
test('WhatsApp business messaging requires actual click attribution and WABA',async()=>{
  const f=fixture();f.env.OFLAN_ACTION_SOURCE='business_messaging';f.env.OFLAN_WABA_ID='123456789';
  assert.equal((await handle(f.req('mark-paid',f.body),f.env,f.send)).status,400);
  await handle(f.req('mark-paid',{...f.body,ctwa_clid:'test_click_id_only'}),f.env,f.send);
  const e=f.calls[0].payload.data[0];assert.equal(e.action_source,'business_messaging');assert.equal(e.messaging_channel,'whatsapp');assert.equal(e.user_data.whatsapp_business_account_id,'123456789');assert.equal(e.user_data.ctwa_clid,'test_click_id_only');
});
test('old event is not silently re-dated or sent',async()=>{
  const f=fixture();await handle(f.req('mark-paid',f.body),f.env,async()=>{throw 0;});
  const old=f.sqlite.prepare('SELECT payload FROM of_orders').get().payload;
  const result=await deliver(f.db,f.env,'test',f.body.order_id,f.send,Date.now()+8*86400000);assert.equal(result.status,'FAILED');assert.equal(f.calls.length,0);assert.equal(f.sqlite.prepare('SELECT payload FROM of_orders').get().payload,old);
});
test('Oflan rejects Bom Flan dataset and cannot fall back to Bom Flan credentials',async()=>{
  const f=fixture();
  for(const env of [
    {...f.env,OFLAN_DATASET_ID:'1626416872401155',OFLAN_DATASET_VERIFIED:'1626416872401155'},
    {...f.env,OFLAN_META_TOKEN:'',BOMFLAN_META_TOKEN:'wrong-brand-token'},
    {...f.env,OFLAN_DATASET_VERIFIED:'999'}
  ]) assert.equal((await handle(f.req('mark-paid',f.body),env,f.send)).status,503);
  assert.equal(f.calls.length,0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM of_orders').get().n,0);
});
test('Oflan does not access Bom Flan tables even if bindings share a database',async()=>{
  const f=fixture();f.sqlite.exec(readFileSync(new URL('../migrations/0001_bomflan.sql',import.meta.url),'utf8'));
  await handle(f.req('mark-paid',f.body),f.env,f.send);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM bf_orders').get().n,0);
  assert.equal((await (await handle(f.req('history-today'),f.env,f.send)).json()).orders.length,1);
});
test('failed persistence cannot send an event; legacy and Bom Flan IDs are rejected',async()=>{
  const f=fixture();
  for(const order_id of ['2609270001','BF-TEST-260927-0001'])assert.equal((await handle(f.req('mark-paid',{...f.body,order_id}),f.env,f.send)).status,400);
  const env={...f.env,OFLAN_DB:{prepare(){throw Error('unavailable');}}};
  assert.equal((await handle(f.req('mark-paid',f.body),env,f.send)).status,503);
  assert.equal(f.calls.length,0);
});
test('live payload has no test code and paid record exists before Meta receives it',async()=>{
  const f=fixture(),body={...f.body,order_id:'OF-260927-0001'};
  const r=await handle(f.req('mark-paid',body,'live'),f.env,async(url,options)=>{
    assert.equal(f.sqlite.prepare('SELECT status FROM of_orders').get().status,'SENDING');
    assert.equal(JSON.parse(options.body).test_event_code,undefined);
    return f.send(url,options);
  });
  assert.equal((await r.json()).status,'SUCCESS');
});
