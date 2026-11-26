import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const source=name=>readFileSync(new URL("../dist/"+name,import.meta.url),"utf8");
const api=vm.runInNewContext(source("soto.js")+source("clubswan.js")+";({swanSpeed,updateSwanFoil,updateSotoInventory,drawClubSwan})");

test("ClubSwan 36 matches the five published boat speeds without a wind-side discontinuity",()=>{
  for(const [wind,twa,expected] of [[8,43,6.9],[16,37,8],[10,140,9.1],[20,147,21],[14,80,18.4]]){
    for(const angle of [twa,-twa])assert.equal(api.swanSpeed(wind,angle),expected);
    assert.ok(Math.abs(api.swanSpeed(wind+.001,twa)-expected)<.01);
  }
  assert.equal(api.swanSpeed(0,80),0);
  assert.equal(api.swanSpeed(20,20),0);
});
test("ClubSwan foil traverses on a tack, centers on a run and loses lift at rest",()=>{
  const b={lee:1,waterSpeed:8,heel:.28};
  api.updateSwanFoil(b,43,8,10);
  assert.ok(b.foilRotation>.94 && b.foilLift>0);
  b.lee=-1;
  api.updateSwanFoil(b,43,8,10);
  assert.ok(b.foilRotation<-.94);
  api.updateSwanFoil(b,147,20,10);
  assert.ok(Math.abs(b.foilRotation)<.001);
  b.waterSpeed=0;
  api.updateSwanFoil(b,80,14,1);
  assert.equal(b.foilLift,0);
});
test("ClubSwan automatic jib has two sizes and hysteresis",()=>{
  const b={};
  for(const [wind,expected] of [[13,1],[18,2],[14.5,2],[12,1],[30,2]]){
    api.updateSotoInventory(b,wind,80,.1,true);
    assert.equal(b.jibNumber,expected);
  }
});
