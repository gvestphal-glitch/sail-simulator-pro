import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

const sim=vm.createContext({});
for(const module of ["soto","brasil40","classics"])
 vm.runInContext(readFileSync(new URL("../dist/"+module+".js",import.meta.url),"utf8"),sim);
const designs=vm.runInContext("classicDesigns",sim);
for(const [id,d] of Object.entries(designs)){
 test(id+" tem dimensões próprias, fundo e faixa pretos e velas móveis",()=>{
   assert.equal(d.stations.at(-1)[0]-d.stations[0][0],d.length);
   assert.equal(Math.max(...d.stations.map(row=>row[1]))*2,d.beam);
   assert.ok(d.stations.every((r,i)=>!i||r[0]>d.stations[i-1][0]));
   d.sections=d.stations;
   for(const spiHoist of [0,.47,1])for(const lee of [-1,1]){
     const b={lee,spiHoist,spiFill:spiHoist,poleAngle:-lee,mainSail:{angle:lee*.77},jibSail:{angle:lee*.81},rudderAngle:lee*.2};
     const check=(...points)=>assert.ok(points.every(p=>p.every(Number.isFinite)));
     const paint=new Set(),sails=new Set();
     const quad=(a,b,c,d)=>check(a,b,c,d);
     sim.drawVintageSloop(b,d,quad,(a,b,c,d,color)=>{quad(a,b,c,d);paint.add(color.join());},
       (a,b)=>check(a,b),(a,b,c,d,color,light,kind)=>{quad(a,b,c,d);sails.add(kind);},1,[.7,.72,.76],(c,r)=>check(c,r));
     assert.ok(paint.has("0.044,0.046,0.047")&&paint.has("0.065,0.065,0.068"));
     assert.equal(sails.has(17),spiHoist>0);
   }
 });
}
