"use strict";

function waveNumber(omega,depth){
  let k=omega**2/9.81;
  for(let iteration=0;iteration<6;iteration++){
    const th=Math.tanh(k*depth);
    k-=(9.81*k*th-omega**2)/(9.81*(th+k*depth*(1-th**2)));
  }
  return k;
}
function makeWater(w){
  const depth=10+Math.max(-2,Math.min(2,w.tide));
  const period=Math.max(2,w.period);
  // Independent wind sea: longer, faster crests build on top of the chosen swell.
  const knots=Math.max(0,Math.min(55,w.wind));
  const energy=knots*knots/(knots+7);
  const periodGrowth=knots/(1+.018*knots);
  const spread=[
    [w.waveDir,period,.36*Math.min(w.wave,4),0],
    [w.waveDir+24,period*.73,.14*Math.min(w.wave,4),1.3],
    [w.dir-13,1.25+.063*periodGrowth,.022*energy,2.1],
    [w.dir+28,.94+.031*periodGrowth,.007*energy,4.7]
  ];
  return spread.map(([bearing,seconds,amplitude,offset])=>{
    const a=bearing*Math.PI/180, omega=2*Math.PI/seconds;
    const k=waveNumber(omega,depth);
    return {x:Math.sin(a),z:-Math.cos(a),k,omega,amplitude,offset,orbital:Math.min(1.5,1/Math.tanh(k*depth)),steepness:Math.min(.13,k*amplitude*.45)};
  });
}
function waterSample(waves,x,z,t){
  let height=0,slopeX=0,slopeZ=0,vx=0,vz=0;
  for(const w of waves){
    const phase=w.k*(x*w.x+z*w.z)+w.omega*t+w.offset;
    const cosine=Math.cos(phase),sine=Math.sin(phase);
    const crest=w.amplitude*cosine;
    const slope=-w.k*w.amplitude*sine*(1+4*w.steepness*cosine);
    const drift=-w.omega*w.orbital*crest;
    height+=crest+w.amplitude*w.steepness*(2*cosine*cosine-1);
    slopeX+=slope*w.x;slopeZ+=slope*w.z;
    vx+=drift*w.x;vz+=drift*w.z;
  }
  return {height,slopeX,slopeZ,vx,vz};
}

// a points upwind. Increasing phase moves the pattern downwind across the course.
function gustPulse(a,b,t,knots){
  t*=.22+.062*Math.min(55,Math.max(0,knots));
  const front=a*.070+t*.45+1.45*Math.sin(b*.089);
  const patch=.5+.5*Math.sin(b*.056-a*.021+t*.10);
  const ridge=Math.max(0,Math.cos(front));
  return ridge**4*(.30+.70*patch);
}
