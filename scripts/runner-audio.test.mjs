import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

test("Runner tension, loaded release and sheet trim have distinct sound triggers",()=>{
  const read=name=>readFileSync(new URL("../dist/"+name+".js",import.meta.url),"utf8");
  const game=read("game"),hits=[];
  const param=()=>({value:0,setTargetAtTime(){}});
  const ctx={sampleRate:16000,currentTime:0,state:"running",destination:{},
    createBuffer:(_,n)=>({samples:new Float32Array(n),getChannelData(){return this.samples;}}),
    createBufferSource:()=>({playbackRate:param(),connect(node){this.node=node;},start(){
      if(!this.loop && this.node.gain)hits.push(this.node.gain.value);
    }}),
    createGain:()=>({gain:param(),connect(){}}),
    createBiquadFilter:()=>({frequency:param(),Q:param(),connect(){}})
  };
  const env=vm.createContext({ctx,classes:{soto40:{ocean:true,jibShare:.3}},boatClass:"soto40",time:0,oceanTime:0,
    smoothStep:(a,z,x)=>Math.max(0,Math.min(1,(x-a)/(z-a))),apparent:()=>({speed:11})});
  vm.runInContext(read("soto")+game.slice(game.indexOf("function seaAudio"),game.indexOf("function horn"))+
    "const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));",env);
  const boat={main:55,jib:45,mainSail:{sideLoad:1},jibSail:{sideLoad:1},waterSpeed:3,heaveRate:0,pitchRate:0};
  const play=env.seaAudio(ctx);
  function step(angle,on=true){
    env.updateRunners(boat,angle,21,.1);ctx.currentTime+=.1;play(boat,on);
  }
  step(1);boat.main=6;step(1);
  assert.deepEqual(hits,[]); // Grinding the mainsheet never trips the backstay crack.
  step(-1);assert.ok(boat.runnerLoads[1]>.8);
  for(let i=0;i<40;i++)step(-1);
  assert.ok(hits.length>=4 && boat.runnerLoads[0]>.8 && boat.runnerLoads[1]<.001);
  hits.length=0;
  for(let i=0;i<30;i++)step(-1);
  assert.deepEqual(hits,[]);
  boat.main=70;step(-1);assert.ok(Math.max(...hits)>.65);
  hits.length=0;for(let i=0;i<40;i++)step(1,false);
  step(1);assert.deepEqual(hits,[]);
});
