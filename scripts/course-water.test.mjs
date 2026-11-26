import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const source=readFileSync(new URL("../dist/game.js",import.meta.url),"utf8");
const water=readFileSync(new URL("../dist/water.js",import.meta.url),"utf8");
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end));
const {makeCourse,passed,makeWater,waterSample}=vm.runInNewContext([
  section("const rad","const fmt"),
  water,
  section("function makeCourse","function setup"),
  section("function passed","const canvas="),
  "({makeCourse,passed,makeWater,waterSample})"
].join("\n"));
const weather={wind:12,dir:0,tide:0,wave:.5,waveDir:0,period:7};
const course=makeCourse({x:0,y:0},weather);
const p=(x,y)=>({x,y});

for(const radius of [2,6,18,36]){
  test("Montagem a "+radius+" m das marcas em cada volta",()=>{
    for(let lap=0;lap<3;lap++){
      const [entry,exit,offset,depart,gate]=course.targets.slice(1+6*lap);
      assert.ok(passed(p(radius,-31),p(radius,-33),entry));
      assert.ok(!passed(p(-radius,-31),p(-radius,-33),entry));
      assert.ok(passed(p(1,-32-radius),p(-1,-32-radius),exit));
      assert.ok(!passed(p(-1,-32-radius),p(1,-32-radius),exit));
      assert.ok(passed(p(-23,-32-radius),p(-25,-32-radius),offset));
      assert.ok(passed(p(-24-radius,-33),p(-24-radius,-31),depart));
      assert.ok(passed(p(0,97),p(0,99),gate));
      assert.ok(!passed(p(23,97),p(23,99),gate));
      if(lap===2)continue;
      for(const side of [-1,1]){
        const leave=course.targets[6+6*lap];
        assert.ok(passed(p(21*side,98+radius),p(23*side,98+radius),leave));
        assert.ok(!passed(p(21*side,98-radius),p(23*side,98-radius),leave));
      }
    }
  });
}

test("Largada e chegada respeitam o sentido da linha",()=>{
  for(const target of [course.targets[0],course.targets.at(-1)]){
    const {a,b,normal}=target.gate;
    const side=d=>p((a.x+b.x)/2+d*normal.x,(a.y+b.y)/2+d*normal.y);
    assert.ok(passed(side(-1),side(1),target));
    assert.ok(!passed(side(1),side(-1),target));
  }
});

test("Mar de vento cresce com o vento e mantém escalas distintas",()=>{
  let last=0;
  for(const wind of [0,5,12,18,30,55]){
    const waves=makeWater({...weather,wind,wave:0});
    const wavelength=2*Math.PI/waves[2].k;
    assert.ok(wavelength>last && waves[2].k<waves[3].k);
    if(wind===12)assert.ok(wavelength>13 && wavelength<17);
    const s=waterSample(waves,24,12,3);
    for(const v of Object.values(s))assert.ok(Number.isFinite(v));
    if(!wind)assert.equal(s.height,0);
    last=wavelength;
  }
});

test("Sete pernas, com desmarque e montagem do gate na mesma perna",()=>{
  assert.deepEqual(Array.from(course.targets,t=>t.leg??0),
    [0,1,1,2,2,2,2,3,3,4,4,4,4,5,5,6,6,6,7]);
  assert.equal(course.legCount,7);
});

test("Folgar abre todas as escotas e restaura o ajuste manual ou automático",()=>{
  const controls={mainTrim:{value:"29"},jibTrim:{value:"43"}};
  const rig=vm.createContext({$:id=>controls[id],autoTrim:false});
  vm.runInContext(section("const rad","const fmt")+section("const rigs=","function updateSail"),rig);
  const boat={};
  rig.setPlayerSheets(boat,1,true);
  assert.deepEqual(boat,{main:100,jib:100});
  rig.setPlayerSheets(boat,1,false);
  assert.deepEqual(boat,{main:29,jib:43});
  rig.autoTrim=true;
  rig.setPlayerSheets(boat,1,false);
  const previous=boat.main;
  rig.setPlayerSheets(boat,1,true);
  assert.deepEqual(boat,{main:100,jib:100});
  rig.setPlayerSheets(boat,1.25,false);
  assert.ok(boat.main>previous && boat.main<100 && boat.jib<100);
});

for(const boatClass of ["clubswan36","brasil40","columbia50","arpege30","cal40"])test(boatClass+" navega na raia de oceano com SOG coerente",()=>{
  const sim=vm.createContext({performance,$:()=>({value:50})});
  vm.runInContext([
    section("const rad","const fmt"), water,
    ...["soto","clubswan","brasil40","classics"].map(name=>readFileSync(new URL("../dist/"+name+".js",import.meta.url),"utf8")),
    section("const classes=","const venues="),section("function makeCourse","function setup"),
    section("function setup","const canvas="),section("function hullFront","function updateStartClock"),
    'const chosenVenue=()=>({x:0,y:0}); const resetRules=()=>{};',
    'const windDirection=()=>218, manualWind=20; let windShift=null;',
    'const conditions={wind:20.5,gust:20.5,dir:218,current:.3,currentDir:70,wave:.4,waveDir:210,period:6,tide:0};',
    `boatClass="${boatClass}"; state="countdown"; autoTrim=true; setup();`
  ].join("\n"),sim);
  assert.ok(Math.abs(vm.runInContext("Math.hypot(course.startLine.b.x-course.startLine.a.x,course.startLine.b.y-course.startLine.a.y)",sim)-414)<1e-7);
  const b=vm.runInContext("boats[0]",sim);
  if(boatClass==="brasil40"){
    const sample=()=>vm.runInContext("updateRig(boats[0],windReadings(boats[0],time),.05); rollTarget(boats[0],18,.08)",sim);
    const resting=sample();
    vm.runInContext('keys.add("Space")',sim);
    assert.equal(sample(),resting);
    assert.equal(b.extraHike,0);
    vm.runInContext('keys.delete("Space")',sim);
  }
  const heading=70*Math.PI/180;
  Object.assign(b,{x:649*Math.sin(heading),y:-649*Math.cos(heading),h:heading,vx:2*Math.sin(heading),vy:-2*Math.cos(heading)});
  const dt=1/40;
  for(let step=0;step<480;step++){
    const x=b.x,y=b.y;
    vm.runInContext("oceanTime+=1/40; simulate(boats[0],1/40)",sim);
    assert.ok((b.x-x)*Math.sin(heading)-(b.y-y)*Math.cos(heading)>0);
    assert.ok(Math.abs(b.speed-Math.hypot(b.x-x,b.y-y)/dt)<1e-8);
  }
  assert.ok(Math.hypot(b.x,b.y)>675);
});

test("Comprimento longitudinal das pernas por classe",()=>{
  for(const scale of [1,1.5,2]){
    const c=makeCourse({x:0,y:0},weather,scale);
    assert.equal(c.startLine.a.y-c.marks[0].y,180*scale);
    assert.equal(c.marks[2].y-c.marks[0].y,130*scale);
  }
});

test("Largada de oceano aceita cruzamentos até 207 m de cada lado",()=>{
  const c=makeCourse({x:0,y:0},weather,1852/180,207);
  assert.equal(c.startLine.b.x-c.startLine.a.x,414);
  assert.equal(course.startLine.b.x-course.startLine.a.x,138);
  for(const side of [-1,1]){
    const crosses=(x,target)=>passed(p(side*x,149),p(side*x,147),target);
    assert.ok(crosses(206,c.targets[0]));
    assert.ok(!crosses(208,c.targets[0]));
    assert.ok(!crosses(206,course.targets[0]));
  }
  assert.ok(c.finishLine.a.x>c.startLine.b.x);
});
