import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const sim=vm.createContext({});
for(const name of ["soto","brasil40"])
  vm.runInContext(readFileSync(new URL("../dist/"+name+".js",import.meta.url),"utf8"),sim);

test("Balão simétrico enche na popa, transfere o pau pelo través da proa e arria",()=>{
  const boat={spiUp:true,lee:-1,spiSheet:75};
  const step=angle=>sim.updateBrasilSpi(boat,angle,14,Math.abs(angle),false,.05);
  for(let i=0;i<180;i++)step(173);
  assert.equal(boat.spiHoist,1);assert.ok(boat.spiFill>.95 && boat.spiTravel>.95);
  for(let i=0;i<100;i++){
    const prev=boat.poleAngle;step(-168);
    assert.ok(Math.abs(prev-boat.poleAngle)<=.043);
    sim.drawBrasilSpi(boat,y=>[0,y,1.2],(a,b)=>assert.ok([...a,...b].every(Number.isFinite)),
      (a,b,c,d)=>assert.ok([...a,...b,...c,...d].every(Number.isFinite)),i*.05,[],[],[]);
  }
  assert.ok(boat.spiTravel<-.95);
  for(let i=0;i<60;i++)step(35);
  assert.ok(boat.spiFill<.01);
  boat.spiUp=false;
  for(let i=0;i<65;i++)step(120);
  assert.equal(boat.spiHoist,0);
});

test("A faixa vinho acompanha o casco e preserva a superfície entre as três pinturas",()=>{
  const face=[[-1,-.8,0],[1,-.8,0],[1,.8,0],[-1,.8,0]];
  const parts=sim.brasilPaintFaces(face);
  assert.equal(parts.length,3);
  let area=0;
  for(const [i,[points]] of parts.entries()){
    for(const [,y] of points){
      assert.ok(y>=[-.8,.055,.145][i] && y<=[.055,.145,.8][i]);
    }
    for(let j=0;j<points.length;j++){
      const [x,y]=points[j],[u,v]=points[(j+1)%points.length];
      area+=(x*v-y*u)/2;
    }
  }
  assert.ok(Math.abs(area-3.2)<1e-9);
});

test("Balão do Brasil arma por fora do estai durante o içamento e o jibe",()=>{
  for(const i of [0,1])for(const poleAngle of [-1.48,-.32,0,.32,1.48]){
    for(const spiHoist of [.1,.6,1])for(const jibSide of [-1,1]){
      const boat={i,poleAngle,spiHoist,spiFill:spiHoist*.95,jibSail:{angle:jibSide*1.1}};
      let vertices=0;
      sim.drawBrasilSpi(boat,y=>[0,y,1.47-.035*(y-1)],()=>{},(a,b,c,d)=>{
        for(const v of [a,b,c,d]){
          if(v[0]*jibSide>=0 || Math.abs(v[0])<.10){
            assert.ok(v[2]>5.98-(v[1]-1.49)*4.36/10.73);
            vertices++;
          }
        }
      },1,[],[],[]);
      assert.ok(vertices>20);
    }
  }
});

test("A genoa arria no convés, reverte a meia adriça e volta ao perfil original",()=>{
  const b={spiHoist:0,spiUp:true,lee:-1};
  const step=()=>sim.updateBrasilSpi(b,145,13,150,false,.05);
  for(let i=0;i<55;i++)step();
  const partial=sim.brasilGenoaHoist(b);
  assert.ok(partial>0 && partial<1);
  b.spiUp=false;step();
  assert.ok(sim.brasilGenoaHoist(b)>partial);
  b.spiUp=true;
  for(let i=0;i<100;i++)step();
  assert.equal(sim.brasilGenoaHoist(b),0);
  const flying=[0,12.22,1.62,0,1];
  for(let i=0;i<=12;i++)for(let j=0;j<=8;j++){
    const [x,y,z]=sim.brasilGenoaPoint(flying,i/12,j/8,0);
    assert.ok(Math.abs(x)<.96 && y<1.55 && y>1.15 && z>=3 && z<=5.98);
  }
  b.spiUp=false;
  for(let i=0;i<80;i++)step();
  assert.equal(sim.brasilGenoaPoint(flying,1,0,sim.brasilGenoaHoist(b)),flying);
});

test("O balão cheio mantém ombros largos e esteira arredondada entre os punhos",()=>{
  for(const poleAngle of [-1.45,1.45]){
    const boat={poleAngle,spiFill:1,spiHoist:1};
    const mesh=new Map();
    sim.drawBrasilSpi(boat,y=>[0,y,1.45],()=>{},(...args)=>{
      for(const p of args.slice(0,4))mesh.set(p[3]+","+p[4],p);
    },0,[],[],[]);
    const at=(u,v)=>mesh.get(u+","+v);
    const width=v=>at(1,v)[0]-at(0,v)[0];
    assert.ok(width(.5)>width(0)*.88);
    assert.ok(width(.75)>width(0)*.60);
    assert.ok(at(.5,0)[1]+.65<Math.min(at(0,0)[1],at(1,0)[1]));
    assert.ok(at(.5,.5)[2]>(at(0,.5)[2]+at(1,.5)[2])/2+1.5);
  }
});
