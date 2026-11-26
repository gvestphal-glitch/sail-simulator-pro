import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const api=vm.runInNewContext(readFileSync(new URL("../dist/soto.js",import.meta.url),"utf8")+";({sotoSpeed,updateSotoInventory,updateSotoKite,sotoSailFactor})");
test("ORC: speed through water and conversion of upwind VMG",()=>{
 assert.equal(api.sotoSpeed(12,90),9.54);
 assert.ok(Math.abs(api.sotoSpeed(12,37.9)*Math.cos(37.9*Math.PI/180)-5.85)<1e-6);
 assert.equal(api.sotoSpeed(0,52),0);
 assert.equal(api.sotoSpeed(4,52),4.87);
 assert.equal(api.sotoSpeed(24,150),17.34);
});
test("Jib changes with wind, holds through gusts, respects manual selection",()=>{
 const b={};
 for(const [wind,expected] of [[8,1],[12.5,1],[14,2],[20.4,2],[22,3],[19.4,3],[17,2]]){
  api.updateSotoInventory(b,wind,55,.1);
  assert.equal(b.jibNumber,expected);
 }
 b.jibManual=2;api.updateSotoInventory(b,6,50,.1);assert.equal(b.jibNumber,2);
});
test("Asymmetric hoists and drops progressively and affects downwind speed",()=>{
 const b={spiUp:true};api.updateSotoInventory(b,14,145,1.4);assert.equal(b.spiHoist,0);assert.equal(b.halyardCrew,1);
 api.updateSotoInventory(b,14,145,2.4);assert.equal(b.spiHoist,.5);
 api.updateSotoInventory(b,14,145,2.4);assert.equal(b.spiHoist,1);api.updateSotoKite(b,110,13,14,false,3);const set=api.sotoSailFactor(b,14,145,false);
 b.spiUp=false;api.updateSotoInventory(b,14,145,2.4);assert.equal(b.spiHoist,0);
 assert.ok(api.sotoSailFactor(b,14,145,false)<set);
});

test("Kite collapses, catches, fills and blanks with apparent wind on either tack",()=>{
 const b={spiHoist:1};
 const sail=(angle,aws,tws,eased=false)=>{
   for(let i=0;i<180;i++)api.updateSotoKite(b,angle,aws,tws,eased,1/30);
   return b.spiFill;
 };
 assert.ok(sail(32,18,16)<.01 && b.spiFlutter>.99 && b.spiSide<0);
 assert.ok(sail(85,18,16)>.99);
 const loaded=b.spiLoad;
 assert.ok(sail(-85,18,16)>.99 && b.spiSide>0);
 assert.ok(sail(85,18,16,true)<.08 && b.spiLoad<loaded/3);
 assert.ok(sail(55,12,8)>.85 && sail(55,22,20)<.01);
 assert.ok(sail(179,12,10)<.17);
 sail(0,20,18);assert.equal(Math.abs(b.spiSide),0);
 sail(95,0,0);assert.equal(b.spiFlutter,0);assert.equal(b.spiLoad,0);
 b.spiHoist=0;sail(90,22,18);assert.equal(b.spiLoad,0);assert.equal(b.spiFill,0);
});
test("Flying and luffing rigs retain valid cloth coordinates and pinned corners",()=>{
 const {drawSoto40,sotoMembrane}=vm.runInNewContext(readFileSync(new URL("../dist/soto.js",import.meta.url),"utf8")+";({drawSoto40,sotoMembrane})");
 const sail={angle:.65,camber:.10,flutter:.8};
 for(const time of [0,.7,1.8]){
   assert.equal(sotoMembrane(sail,.65,.35,0,4,time,true),0);
   assert.equal(sotoMembrane(sail,.65,0,.55,4,time,true),0);
 }
 assert.notEqual(sotoMembrane(sail,.65,.6,.8,4,.3,true),sotoMembrane(sail,.65,.6,.8,4,.7,true));
 const stations=[[-6.17,1.42,.94,1.1],[.8,1.8,1.05,0],[6.17,.014,1.08,0]];
 for(const fill of [0,.5,1]){
   let panels=0;
   const inspect=(a,b,c,d,color,light,kind)=>{
     if(kind<16)return;
     panels++;
     for(const point of [a,b,c,d]){
       assert.ok(point.every(Number.isFinite));
       assert.ok(point[3]>=0&&point[3]<=1&&point[4]>=0&&point[4]<=1);
     }
   };
   const noop=()=>{};
   drawSoto40({i:0,mainSail:sail,jibSail:sail,lee:1,spiUp:true,spiHoist:1,spiFill:fill,spiFlutter:1-fill,spiBeat:2.1},
     {sections:stations,stations},noop,noop,noop,inspect,1,[.7,.7,.7]);
   assert.ok(panels>=400);
 }
});

test("Spi sheet changes the pressure on the flying sail",()=>{
 const fill=sheet=>{
   const boat={spiHoist:1,spiSheet:sheet};
   api.updateSotoKite(boat,100,15,12,false,10);
   return boat.spiFill;
 };
 assert.ok(fill(45)>fill(100)+.45);
 assert.ok(fill(45)>fill(0)+.30);
});
test("Halyard crew can abort, resume, and return to the rail after the hoist",()=>{
 const boat={spiUp:true,crewOffset:-1};
 const move=dt=>api.updateSotoInventory(boat,12,120,dt);
 move(.7);assert.equal(boat.halyardCrew,.5);assert.equal(boat.hoistSide,-1);
 boat.spiUp=false;move(.2);assert.ok(boat.halyardCrew<.5);assert.equal(boat.spiHoist,0);
 boat.spiUp=true;move(2);const partly=boat.spiHoist;assert.ok(partly>0&&partly<1);
 boat.spiUp=false;move(.12);assert.ok(boat.spiHoist<partly);
 boat.spiUp=true;move(6);assert.equal(boat.spiHoist,1);
 move(2);assert.equal(boat.halyardCrew,0);assert.equal(boat.spiHoist,1);
});
test("Seven sailors extend both arms on either rail while helm keeps the tiller",()=>{
 const {drawSoto40}=vm.runInNewContext(readFileSync(new URL("../dist/soto.js",import.meta.url),"utf8")+";({drawSoto40})");
 const stations=[[-6.17,1.78,.94,1.49],[0,1.8,1,0],[6.17,.014,1.08,0]];
 function palms(side,effort){
   const hands=[];
   const line=(a,b,r)=>{if(r===.043)hands.push(Array.from(a));};
   const noop=()=>{};
   drawSoto40({i:0,crewOffset:side,extraHike:effort,mainSail:{},jibSail:{},lee:-side},
     {sections:stations,stations},noop,noop,line,noop,1,[.7,.7,.7]);
   return hands;
 }
 for(const side of [-1,1]){
   const rest=palms(side,0),hiking=palms(side,1);
   assert.equal(hiking.length,16);
   assert.deepEqual(hiking.slice(0,2),rest.slice(0,2));
   for(const [i,p] of hiking.slice(2).entries())assert.ok((p[0]-rest[i+2][0])*side>.60);
   assert.ok(rest[15][2]<rest[1][2]-1);
 }
});

test("Spinnaker unloads, crosses forward of the tack and refills without snapping on reversal",()=>{
 const {updateSotoKite,flyingSpi}=vm.runInNewContext(readFileSync(new URL("../dist/soto.js",import.meta.url),"utf8")+";({updateSotoKite,flyingSpi})");
 for(const wind of [3,18]){
  const b={spiHoist:1},tack=[0,1,8],head=[0,17,.5],dt=.025;
  const step=awa=>updateSotoKite(b,awa,wind,wind,false,dt);
  for(let i=0;i<250;i++)step(110);
  const initial=b.spiFill;
  step(-179);
  assert.equal(b.spiTravel,-1);
  while(b.spiTravel<0)step(-120);
  assert.ok(b.spiFill<initial*.5 && b.spiShoulder<b.spiTravel);
  assert.ok(flyingSpi(b,0,1,tack,head,5,8,0)[2]>tack[2]);
  const mid=b.spiTravel;
  step(120);
  assert.ok(b.spiTravel<mid && b.spiTravel>mid-.04);
  for(let i=0;i<300;i++)step(-120);
  assert.ok(b.spiTravel===1 && b.spiFill>.95);
  for(const [v,corner] of [[0,tack],[1,head]]){
   const p=flyingSpi(b,v,0,tack,head,5,8,0);
   assert.ok(p.every((n,i)=>Math.abs(n-corner[i])<1e-8));
  }
  b.spiHoist=0;step(-120);assert.equal(b.spiTravel,undefined);
 }
});
