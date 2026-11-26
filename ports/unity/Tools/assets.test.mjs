import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('../Assets/Resources/',import.meta.url);
for(const id of ['ilca','snipe','star','optimist']){
 test('geometry and polar '+id,()=>{
  for(const part of ['hull','crew','main','lines',...(['snipe','star'].includes(id)?['jib']:[])]){
   const b=fs.readFileSync(new URL('Models/'+id+'-'+part+'.bytes',root)),n=b.readInt32LE();
   assert.equal(n%3,0);assert.ok(n>0);assert.equal(b.length,4+n*16);
   for(let j=0;j<n;j++)for(let axis=0;axis<3;axis++)assert.ok(Number.isFinite(b.readFloatLE(4+j*16+axis*4)));
  }
  const p=fs.readFileSync(new URL(id+'-polar.bytes',root));assert.equal(p.length,121*181*4);
  assert.equal(p.readFloatLE(0),0);
  const [angle,kn]={ilca:[40,4.78],snipe:[38,4.98],star:[175,6.45],optimist:[44,3.45]}[id];
  assert.ok(Math.abs(p.readFloatLE(4*(24*181+angle))-kn)<.001);
 });
}
for(const key of ['santos','canas','rio','committee'])test('compatible scenery '+key,()=>{
 const b=fs.readFileSync(new URL('Models/'+key+'.bytes',root));assert.equal(b.length,4+b.readInt32LE()*16);assert.ok(b.length>30000);
});
test('crew animation meshes preserve vertex correspondence',()=>{
 for(const id of ['star','ilca','optimist','snipe']){
  const rest=fs.readFileSync(new URL('Models/'+id+'-crew.bytes',root));
  for(const pose of (id==='star'?['mast','hike']:['hike'])){
   const moving=fs.readFileSync(new URL('Models/'+id+'-crew-'+pose+'.bytes',root));
   assert.equal(moving.length,rest.length);assert.notDeepEqual(moving,rest);
  }
 }
});

test('wind sea moves faster and gets steeper without altering swell',async()=>{
  const {runInNewContext}=await import('node:vm');
  const water=fs.readFileSync(new URL('../LegacyWeb/dist/water.js',import.meta.url),'utf8');
  const {makeWater,waterSample}=runInNewContext(water+';({makeWater,waterSample})');
  const sea={wave:.6,waveDir:100,dir:20,period:7,tide:.4};
  let previous;
  for(const wind of [0,5,15,25,40]){
    const waves=makeWater({...sea,wind});
    if(previous){
      assert.deepEqual(waves.slice(0,2),previous.slice(0,2));
      for(const i of [2,3]){
        const w=waves[i],p=previous[i];
        assert.ok(w.amplitude*w.k>p.amplitude*p.k);
        assert.ok(w.omega/w.k>p.omega/p.k);
        assert.ok(w.amplitude*w.omega>p.amplitude*p.omega);
      }
    }
    previous=waves;
  }
  const flat=waterSample(makeWater({...sea,wave:0,wind:0}),11,3,8);
  assert.ok(Object.values(flat).every(v=>v===0));
});
