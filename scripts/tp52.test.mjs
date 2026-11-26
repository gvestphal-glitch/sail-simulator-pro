import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const ctx=vm.createContext({});
for(const file of ["soto","tp52"])
  vm.runInContext(readFileSync(new URL("../dist/"+file+".js",import.meta.url),"utf8"),ctx);
test("TP52 target speeds and symmetry on opposite tacks",()=>{
 for(const [wind,angle,value] of [[12,90,11.37],[20,135,16.11],[24,150,19.17],[7,52,8.32],[0,90,0]])
   for(const side of [-1,1])assert.ok(Math.abs(ctx.tp52Speed(wind,side*angle)-value)<1e-8);
});
test("TP52 gear, sails and grinders emit finite coordinates through a gybe",()=>{
 let lines=0;
 const line=(a,b)=>{assert.ok([...a,...b].every(Number.isFinite));lines++;};
 const quad=(a,b,c,d)=>{line(a,b);line(c,d);};
 const boat={mainSail:{angle:.5},jibSail:{angle:.4},rudderAngle:.1,spiUp:true,spiHoist:1,
   spiTravel:-.2,spiFill:.6,halyardCrew:.4,crewOffset:.3,grindPhase:2};
 ctx.drawTP52(boat,{sections:[[-7.925,1.85,1.04,1.49],[0,2,1.2,0],[7.925,.02,1.27,0]]},
   quad,quad,line,quad,4,[.7,.7,.7],line);
 assert.ok(lines>1000);
});
