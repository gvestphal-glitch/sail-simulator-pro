import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from './worker.mjs';
function service(){
  const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('drizzle/0000_regatta_rooms.sql',import.meta.url),'utf8'));
  function prepare(text){return {bind(...params){
    const stmt=sql.prepare(text);
    return {all:()=>({results:stmt.all(...params)}),first:()=>stmt.get(...params),run:()=>({meta:stmt.run(...params)})};
  }}}
  const DB={prepare,batch(stmts){sql.exec('BEGIN');try{for(const s of stmts)s.run();sql.exec('COMMIT')}catch(e){sql.exec('ROLLBACK');throw e;}}};
  return async(action,body)=>{
    const res=await worker.fetch(new Request('https://game.test/api/rooms/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),{DB});
    return [res.status,await res.json()];
  };
}
const settings={venue:'central',boatClass:'star',sky:'mixed',weather:{wind:11,gust:14,dir:145,wave:.48,waveDir:155,period:7,tide:.15,tideRate:.11,current:.2,currentDir:65}};
test('host plus five seats and readable full-room failure',async()=>{
  const call=service(),[status,host]=await call('create',{name:' Gui ',settings});assert.equal(status,200);
  assert.equal(host.players[0].name,'Gui');for(let i=1;i<=5;i++)assert.equal((await call('join',{code:host.code,name:'Guest '+i}))[0],200);
  assert.equal((await call('join',{code:host.code,name:'Overflow'}))[0],409);
});
test('only host starts; no late join; server clock is eight minutes',async()=>{
  const call=service(),[,h]=await call('create',{name:'Gui',settings}),[,g]=await call('join',{name:'Ana',code:h.code});
  assert.equal((await call('start',{code:h.code,token:g.token}))[0],403);
  const [s,room]=await call('start',{code:h.code,token:h.token});assert.equal(s,200);assert.equal(room.starts-room.now,480000);
  assert.equal((await call('join',{name:'Bia',code:h.code}))[0],409);
});
test('invalid settings, absent credentials and malformed names',async()=>{
  const call=service();assert.equal((await call('create',{name:'',settings}))[0],400);
  assert.equal((await call('create',{name:'Gui',settings:{...settings,boatClass:'???'}}))[0],400);
  assert.equal((await call('sync',{code:'AAAA222',token:'x'}))[0],404);
});
test('host leaving lobby closes room',async()=>{
  const call=service(),[,h]=await call('create',{name:'Gui',settings});assert.equal((await call('leave',{code:h.code,token:h.token}))[0],200);
  assert.equal((await call('join',{code:h.code,name:'Ana'}))[0],404);
});
test('web and native clients exchange boat positions and failed updates preserve last state',async()=>{
  const call=service(),[,h]=await call('create',{name:'Gui',settings}),[,g]=await call('join',{name:'Ana',code:h.code});
  await call('start',{code:h.code,token:h.token});
  const boat=Object.fromEntries('x y h vx vy speed waterSpeed heel pitch heave rudderAngle downSide stage main jib mainAngle jibAngle crewPose extraHike'.split(' ').map(k=>[k,0]));
  boat.x=7;boat.y=-19;
  assert.equal((await call('sync',{code:h.code,token:g.token,boat}))[0],200);
  assert.equal((await call('sync',{code:h.code,token:g.token,boat:{...boat,x:999999}}))[0],400);
  const [,view]=await call('sync',{code:h.code,token:h.token});
  const record=view.players.find(p=>p.id===g.id);assert.equal(record.boat.y,-19);assert.equal(record.boat.x,7);assert.equal(record.token,undefined);
});
test('same-origin gateway keeps web assets and private API separate',async()=>{
 const gateway=(await import('./gateway.mjs')).default;const seen=[];
 const env={ASSETS:{fetch:r=>{seen.push(new URL(r.url).pathname);return new Response('asset');}}};
 for(const path of ['/','/unity/','/unity/Build/world.wasm'])assert.equal(await(await gateway.fetch(new Request('https://game.test'+path),env)).text(),'asset');
 assert.equal((await gateway.fetch(new Request('https://game.test/api/rooms/sync'),env)).status,503);
 assert.deepEqual(seen,['/','/unity/','/unity/Build/world.wasm']);
});
