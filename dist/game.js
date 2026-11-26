"use strict";
const $ = id => document.getElementById(id);
const rad = Math.PI / 180;
const knot = 0.514444;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const vector = a => ({x:Math.sin(a), y:-Math.cos(a)});
const dot = (a,b) => a.x*b.x+a.y*b.y;
const delta = (a,b) => ({x:a.x-b.x,y:a.y-b.y});
const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
const angle = v => Math.atan2(v.x,-v.y);
const fmt = (n,d=1) => n.toLocaleString(sailLocale.language,{minimumFractionDigits:d,maximumFractionDigits:d});
const bearing = a => String(Math.round((a/rad+360)%360)%360).padStart(3,"0")+"°";
const center = {lat:-24.001,lon:-46.334};
const demo = {wind:11,gust:14,dir:145,wave:.48,waveDir:155,period:7,tide:.15,tideRate:.11,current:.20,currentDir:65,live:false};
let weather = {...demo}, conditions = {...demo};
let manualSea=null;
const seaControls=[["level","tide"],["swell-height","wave"],["swell-period","period"],["swell-direction","waveDir"]];
const windShiftButton=$("wind-shift");
let windShiftsEnabled=false, windShift=null;
windShiftButton.onclick=()=>{
  windShiftsEnabled=!windShiftsEnabled;
  windShiftButton.setAttribute("aria-pressed",String(windShiftsEnabled));
  $("wind-shift-status").textContent=windShiftsEnabled?tr("Ligado"):tr("Desligado");
};

function nextWindShift(from,start,random=Math.random){
  const choices=[];
  for(let candidate=-10;candidate<=10;candidate++){
    const change=Math.abs(candidate-from);
    if(candidate!==0&&change>=1&&change<=10)choices.push(candidate);
  }
  return {from,to:choices[Math.floor(random()*choices.length)],start,end:start+18+random()*22};
}
function windDirection(){
  if(!windShift)return conditions.dir;
  const blend=smoothStep(windShift.start,windShift.end,oceanTime);
  return conditions.dir+windShift.from+(windShift.to-windShift.from)*blend;
}
let manualWind=null, baseWind={...demo};
function applyWind(){
  conditions.wind=manualWind??baseWind.wind;
  conditions.gust=manualWind===null?baseWind.gust:manualWind*1.20;
}
function loadConditions(){
  baseWind={...weather};
  conditions={...weather};
  if(manualSea)Object.assign(conditions,manualSea);
  if(chosenVenue().eastWind)conditions.dir=90;
  applyWind();
}
function changeWind(value){
  manualWind=value;
  applyWind();
  course.water=makeWater(conditions);
  showWeather();
}
$("wind-setting").addEventListener("input",event=>changeWind(Number(event.target.value)));
$("env-mode").onchange=()=>{
  const manual=$("env-mode").value==="manual";
  $("manual-env").hidden=!manual;
  manualSea=manual?{tide:conditions.tide,wave:conditions.wave,period:conditions.period,waveDir:Math.round(conditions.waveDir)%360}:null;
  for(const [id,key] of seaControls){
    $(id).value=manualSea?.[key]??(key==="waveDir"?Math.round(conditions.waveDir)%360:Number(conditions[key].toFixed(1)));
  }
  manualWind=manual?Number($("wind-setting").value):null;
  loadConditions();setup();showWeather();
};
for(const [id,key] of seaControls){
  $(id).onchange=()=>{
    if(!manualSea)return;
    const input=$(id);
    const entered=Number(input.value);
    if(input.value!==""&&Number.isFinite(entered)){
      const bounded=clamp(entered,+input.min,+input.max);
      manualSea[key]=key==="waveDir"?Math.round(bounded)%360:bounded;
    }
    input.value=manualSea[key];loadConditions();setup();showWeather();
  };
}
let weatherRequest = 0;
const forecast = "https://api.open-meteo.com/v1/forecast";
const marine = "https://marine-api.open-meteo.com/v1/marine";
async function request(base, params, location) {
  const query = new URLSearchParams({latitude:location.lat,longitude:location.lon,timeformat:"unixtime",...params});
  const response = await fetch(base+"?"+query,{signal:AbortSignal.timeout(10000)});
  if (!response.ok) throw Error("Falha HTTP "+response.status);
  return response.json();
}
function sample(series, name, now, circular=false) {
  const times=series.time;
  const index=times.findIndex(t=>t>=now);
  const hi=index<0?times.length-1:index;
  const lo=Math.max(0,hi-1);
  const a=series[name]?.[lo], b=series[name]?.[hi];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const ratio=times[lo]===times[hi]?0:clamp((now-times[lo])/(times[hi]-times[lo]),0,1);
  return circular?(a+wrap((b-a)*rad)/rad*ratio+360)%360:a+(b-a)*ratio;
}
async function updateWeather(){
  const revision=++weatherRequest;
  const venue=chosenVenue(), location=venue.location??center;
  $("refresh").disabled=true;
  const [wind, sea] = await Promise.allSettled([
    request(forecast,{current:"wind_speed_10m,wind_direction_10m,wind_gusts_10m",wind_speed_unit:"kn",cell_selection:"sea"},location),
    request(marine,{hourly:"swell_wave_height,swell_wave_direction,swell_wave_period,wave_height,wave_direction,wave_period,sea_level_height_msl,ocean_current_velocity,ocean_current_direction",forecast_days:"2",past_days:"1",cell_selection:"sea"},location)
  ]);
  if(revision!==weatherRequest)return;
  const w=wind.value?.current, s=sea.value?.hourly;
  const now=Date.now()/1000;
  const hour=(key,circular)=>s?sample(s,key,now,circular):null;
  const wave=hour("swell_wave_height"), waveDir=hour("swell_wave_direction",true), period=hour("swell_wave_period");
  const swell=[wave,waveDir,period].every(Number.isFinite) && wave>0 && period>0;
  const hs=swell?wave:hour("wave_height"), wd=swell?waveDir:hour("wave_direction",true), tp=swell?period:hour("wave_period");
  const height=hour("sea_level_height_msl"), nextTide=s?sample(s,"sea_level_height_msl",now+3600):null;
  const flow=hour("ocean_current_velocity"), flowDir=hour("ocean_current_direction",true);
  const windOK=[w?.wind_speed_10m,w?.wind_gusts_10m,w?.wind_direction_10m].every(Number.isFinite);
  const waveOK=[hs,wd,tp].every(Number.isFinite);
  const tideOK=Number.isFinite(height)&&Number.isFinite(nextTide);
  const flowOK=Number.isFinite(flow)&&Number.isFinite(flowDir);
  const count=[windOK,waveOK,tideOK,flowOK].filter(Boolean).length;
  weather={...demo,...venue.training,
    ...(windOK&&{wind:w.wind_speed_10m,gust:w.wind_gusts_10m,dir:w.wind_direction_10m}),
    ...(waveOK&&{wave:hs,waveDir:wd,period:tp}),
    ...(tideOK&&{tide:height,tideRate:nextTide-height}),
    ...(flowOK&&{current:flow/(sea.value.hourly_units?.ocean_current_velocity==="km/h"?3.6:1),currentDir:flowDir}),
    windOK,waveOK,tideOK,flowOK,swell, count, updated:Date.now()
  };
  if(state==="idle"){loadConditions(); setup();}
  $("refresh").disabled=false;
  showWeather();
}
function showWeather(){
  const w=conditions;
  const demoMark=ok=>ok?"":" *";
  $("wind-setting").value=String(w.wind);
  $("wind-setting-value").textContent=fmt(w.wind,Number.isInteger(w.wind)?0:1)+" Kts";

  $("weather-status").textContent=manualWind!==null?tr("Condições manuais"):w.count===4?tr("Previsão local"):w.count?tr("Previsão parcial"):tr("Condições de treino");
  $("wind").textContent=fmt(w.wind,manualWind===null?0:1)+" / "+fmt(w.gust,manualWind===null?0:1)+" Kts · "+bearing(w.dir*rad)+demoMark(w.windOK||manualWind!==null);
  $("wave").textContent=fmt(w.wave)+" m · "+fmt(w.period,0)+" s · "+bearing(w.waveDir*rad)+demoMark(w.waveOK||Boolean(manualSea));
  $("tide").textContent=(w.tide>=0?"+":"")+fmt(w.tide)+" m · "+(Math.abs(w.tideRate)<.025?tr("estável"):w.tideRate>0?tr("subindo"):tr("descendo"))+demoMark(w.tideOK);
  $("current").textContent=fmt(w.current/knot)+" Kts · "+bearing(w.currentDir*rad)+demoMark(w.flowOK);
  const time=w.count?new Intl.DateTimeFormat(sailLocale.language,{timeZone:"America/Sao_Paulo",hour:"2-digit",minute:"2-digit"}).format(w.updated):null;
  $("source").textContent=(time?tr("Consultado às")+" "+time+" ("+chosenVenue().region+"). ":"")+(w.count===4?"":("* "+tr("Condições de treino")+". "))+(state==="idle"?(chosenVenue().eastWind?tr("Raia com vento leste. Nível relativo ao mar médio."):tr("Modelo regional. Nível relativo ao mar médio.")):tr("Previsão fixada na largada."));
}
const classes={
  ...Object.fromEntries(Object.entries(classicDesigns).map(([id,d])=>[id,{
    name:d.name,classic:true,length:d.length,beam:d.beam,flag:id,waveSpan:d.lwl/2,
    jibShare:d.I*d.J/(d.I*d.J+d.P*d.E),area:d.area,crewKg:d.crew*78,hullKn:d.hullKn,
    beat:45,planeWind:id==="cal40"?[16,27]:[60,90],drag:.034,inertia:d.inertia,turn:d.turn,
    lightWindLimit:6,rollResponse:.54,noGo:35,hull:"#e8e4d7"
  }])),
  brasil40:{name:"Classe Brasil 40",classic:true,length:12.192,beam:3.06,jibShare:.41,flag:"bl",waveSpan:4.21,
    area:64.1,crewKg:390,hullKn:7.05,beat:46,planeWind:[60,90],drag:.034,inertia:6.7,
    turn:.43,lightWindLimit:6,rollResponse:.54,noGo:35,hull:"#e8e3cd"},
  tp52:{name:"TP52",ocean:true,length:15.85,beam:4.42,jibShare:.40,flag:"tp52",waveSpan:6.1,
    area:157,crewKg:1050,hullKn:9.6,beat:38,planeWind:[13,22],drag:.022,inertia:5.3,
    turn:.48,lightWindLimit:7,rollResponse:.52,noGo:29,hull:"#244967"},
  clubswan36:{name:"ClubSwan 36",ocean:true,length:11,beam:3.60,jibShare:.35,flag:"cs36",waveSpan:4.25,
    area:98.7,crewKg:510,hullKn:7.9,beat:40,planeWind:[13,20],drag:.023,inertia:3.35,
    turn:.67,lightWindLimit:6,rollResponse:.64,noGo:28,hull:"#bdcdd4"},
  soto40:{ocean:true,name:"Soto 40",length:12.34,beam:3.79,jibShare:.38,flag:"s40",waveSpan:4.55,
    area:100,crewKg:680,hullKn:8.4,beat:39,planeWind:[14,25],drag:.024,inertia:4.2,
    turn:.54,lightWindLimit:7,rollResponse:.60,noGo:32,hull:"#e9eeef"},
  optimist:{name:"Optimist",length:2.30,beam:1.13,jibShare:0,flag:"n3",waveSpan:.8,area:3.3,crewKg:42,hullKn:3.55,beat:44,beatKn:[3.15,3.45],planeWind:[17,29],planeKn:7.5,drag:.025,inertia:.83,turn:1.12,lightWindLimit:5,rollResponse:.89,noGo:39,hull:"#f2efe7"},
  ilca:{name:"ILCA 7",length:4.23,beam:1.37,jibShare:0,flag:"n1",waveSpan:1.48,area:7.06,crewKg:81.5,hullKn:4.74,beat:40,beatKn:[4.52,4.78],planeWind:[14,27],planeKn:16.3, drag:.017, inertia:1, turn:1, lightWindLimit:5,rollResponse:.97, noGo:36, hull:"#eef9ed"},
  snipe:{name:"Snipe",length:4.724,beam:1.524,jibShare:.29,flag:"n2",waveSpan:1.65,area:11.9,crewKg:137.5,hullKn:4.95,beat:38,beatKn:[4.71,4.98],planeWind:[18,30],planeKn:11, drag:.019, inertia:1.22, turn:.86, lightWindLimit:6,rollResponse:.76, noGo:35, hull:"#f5f0dc"},
  star:{name:"Star",length:6.922,beam:1.734,jibShare:.23,flag:"star",waveSpan:2.34,
    area:26.5,crewKg:185,hullKn:5.27,beat:42,planeWind:[13,25],drag:.020,inertia:2.65,
    turn:.73,lightWindLimit:5,rollResponse:.70,noGo:37,hull:"#e9f0ef"}
};
let boatClass="ilca", state="idle", time=0, pending=0, zoom=false, boats=[], course;
const keys=new Set(), steering=new Map(), touchActions=new Map();
const holding=code=>keys.has(code)||touchActions.has(code);
let accumulator=0, last=performance.now(), oceanTime=0;
let autoTrim=false,soundOn=true, onlineRace=null;
const venues={
  central:{x:0,y:0,name:"Baía central",region:"Santos",scenery:"santos"},
  north:{x:1840,y:-925,name:"Ponta da Praia",region:"Santos",scenery:"santos"},
  canas:{x:0,y:0,name:"Ponta das Canas",region:"Ilhabela",scenery:"canas",eastWind:true,
    location:{lat:-23.742,lon:-45.370},training:{dir:90,waveDir:92,wave:.27}},
  rio:{x:0,y:0,name:"Santos Dumont",region:"Rio de Janeiro",scenery:"rio",
    location:{lat:-22.917,lon:-43.1582},training:{dir:175,waveDir:154,wave:.32}}
};
function chosenVenue(){return venues[$("venue").value]??venues.central;}
// ANTAQ/SPA, Tomo III, tabela 8 (fonte DHN). UTM offsets anchored at BL 1.
const channelMarks=[
  ["1A",363919.15,7343872.33],["2A",363874.95,7344463.59],
  ["1",364374.92,7344921.61],["2",364328.90,7345385.64],
  ["3",364816.67,7345492.74],["4",365068.85,7345940.51],
  ["5",365643.01,7345886.20],["6",366041.33,7346156.87]
].map(([id,e,n])=>({id,x:e-364374.92+62,y:7344921.61-n+100,red:parseInt(id)%2===1}));
$("venue").onchange=()=>{
  const venue=chosenVenue();
  weather={...demo,...venue.training};
  $("venue-title").textContent=venue.scenery==="santos"?tr("Baía de Santos"):venue.region;
  loadConditions();setup();showWeather();updateWeather();
};
$("auto-trim").onclick=()=>{
  autoTrim=!autoTrim;
  $("auto-trim").setAttribute("aria-pressed",autoTrim);
  for(const id of ["mainTrim","jibTrim","spiTrim"])$(id).disabled=autoTrim;
};
$("sound").onclick=()=>{
  soundOn=!soundOn;$("sound").setAttribute("aria-pressed",soundOn);
};
function makeCourse(venue,conditions,scale=1,startHalfWidth=69){
  const up=vector(conditions.dir*rad);
  const right={x:-up.y,y:up.x};
  const point=(along,across)=>({x:venue.x+up.x*along+right.x*across,y:venue.y+up.y*along+right.y*across});
  const lineAlong=-148;
  const startLine={a:point(lineAlong,-startHalfWidth),b:point(lineAlong,startHalfWidth),normal:up};
  const markAlong=lineAlong+180*scale, gateAlong=lineAlong+50*scale, halfGate=22;
  const down={x:-up.x,y:-up.y};
  const marks=[
    {...point(markAlong,0),label:"1"},
    {...point(markAlong,-24),label:"1A"},
    {...point(gateAlong,-halfGate),label:"2S"},
    {...point(gateAlong,halfGate),label:"2P"}
  ];
  const leewardGate={a:marks[2],b:marks[3],normal:down};
  const finishPoint=point(-137,startHalfWidth+52);
  const finishLine={
    a:point(-156,startHalfWidth+40),b:point(-118,startHalfWidth+64),
    normal:{x:(38*right.x-24*up.x)/Math.hypot(38,24),y:(38*right.y-24*up.y)/Math.hypot(38,24)}
  };
  for(const line of [startLine,finishLine]){
    const starboard={x:-line.normal.y,y:line.normal.x};
    const bIsStarboard=dot(delta(line.b,line.a),starboard)>0;
    line.committee=bIsStarboard?line.b:line.a;
    line.pin=bIsStarboard?line.a:line.b;
  }
  // Each ray starts at the mark. The guide is only an aiming point for the helm.
  const left={x:-right.x,y:-right.y};
  function rounding(mark,ray,normal,guide,name){
    return {p:guide,name,rounding:[mark],gate:{
      a:mark,b:{x:mark.x+ray.x*1500,y:mark.y+ray.y*1500},normal
    },roundingRay:true};
  }
  const windward=[
    rounding(marks[0],right,up,point(markAlong,8),"Deixe a boia 1 por bombordo"),
    rounding(marks[0],up,left,point(markAlong+8,0),"Complete a montagem da boia 1"),
    rounding(marks[1],up,left,point(markAlong+8,-24),"Passe pela boia de desmarque 1A"),
    rounding(marks[1],left,down,point(markAlong,-32),"Deixe a boia 1A por bombordo")
  ];
  const exits=[-1,1].map(side=>({
    p:point(gateAlong-13,side*(halfGate+12)),
    rounding:[marks[side<0?2:3]],
    gate:{
      a:marks[side<0?2:3],b:point(gateAlong-1500,side*halfGate),
      normal:{x:right.x*side,y:right.y*side}
    }
  }));
  const laps=3;
  const targets=[{p:point(lineAlong,0),gate:startLine,name:"Cruze a linha de largada"}];
  for(let lap=1;lap<=laps;lap++){
    const downwindLeg=2*lap;
    targets.push(...windward.map((target,index)=>({...target,leg:index<2?downwindLeg-1:downwindLeg})),
      {p:point(gateAlong,0),gate:leewardGate,leg:downwindLeg,rounding:[marks[2],marks[3]],name:"Passe entre 2S e 2P"});
    if(lap<laps)targets.push({exits,leg:downwindLeg,name:"Contorne 2S ou 2P pelo lado de fora"});
  }
  const legCount=2*laps+1;
  targets.push({p:finishPoint,gate:finishLine,leg:legCount,name:"Cruze a linha de chegada"});
  return {venue,channelMarks:venue.scenery==="santos"?channelMarks:[],marks,startLine,leewardGate,finishLine,targets,legCount,water:makeWater(conditions)};
}
function setup(fleet){
  windShift=null;
  const venue=chosenVenue();
  const ocean=classes[boatClass].ocean||classes[boatClass].classic;
  course=makeCourse(venue,conditions,ocean?1852/180:boatClass==="star"?1.5:1,ocean?3*69:69);
  const up=course.startLine.normal;
  const point=(along,across)=>({x:venue.x+up.x*along-up.y*across,y:venue.y+up.y*along+up.x*across});
  resetRules();
  const solo=["Você","Albatroz","Minuano","Aragem","Boreal","Veleiro Sul"].map((name,seat)=>({name,seat}));
  boats=(fleet??solo).map(({name,seat,id},i)=>({
    ...point(-175-13*Math.floor(seat/5),-57+27*(seat%5)+7*Math.floor(seat/5)),name,i,
    onlineId:id,remote:Boolean(id&&i),h:(seat===0&&venue.scenery==="canas"?133:seat===0&&venue.scenery==="rio"?181:conditions.dir+(seat%2?1:-1)*51)*rad,
    vx:0,vy:0,heel:0,pitch:0,heave:0,rollRate:0,pitchRate:0,heaveRate:0,speed:0,main:27,jib:30,stage:0,finish:null,wake:[],rudderAngle:0,waterSpeed:0,tack:seat%2?1:-1,tackAt:0,trackAt:0,lee:seat%2?1:-1,mainSail:{},jibSail:{},
    gateSide:undefined,penaltySide:seat%2?1:-1,penalties:[],penaltyTurning:false,penaltyProgress:null,
    color:["#e0fc81","#f5a879","#88dbe2","#e8c0f0","#ffc768","#8bbbf5","#f291a5","#9ce0b5","#d6a0ef","#f6d39f","#80cac6"][seat]
  }));
  time=0; pending=0;
  boats.forEach(boat=>updateRig(boat,windReadings(boat,time),0));
}
function windReadings(boat, t){
  const w=conditions, direction=windDirection();
  const localVariation=windShift?0:3.8*Math.sin(t*.10+boat.x*.009)+2*Math.sin(t*.32+boat.y*.018);
  const from=vector((direction+localVariation)*rad), windAxis=vector(direction*rad);
  const along=dot(boat,windAxis), across=boat.y*windAxis.x-boat.x*windAxis.y;
  const speed=(w.wind+Math.max(0,w.gust-w.wind)*gustPulse(along,across,oceanTime,w.wind))*knot;
  const drift=vector(w.currentDir*rad);
  const x=from.x*speed+drift.x*((onlineRace||manualWind===null)?w.current:0);
  const y=from.y*speed+drift.y*((onlineRace||manualWind===null)?w.current:0);
  const reading=(u,v)=>({from:Math.atan2(u,-v),speed:Math.hypot(u,v)});
  return {real:reading(x,y),apparent:reading(x+boat.vx,y+boat.vy)};
}
const apparent=(boat,t)=>windReadings(boat,t).apparent;
const rigs={
  main:{closed:8,open:84,incidence:22},
  jib:{closed:5,open:65,incidence:24}
};
function smoothStep(from,to,value){
  const t=clamp((value-from)/(to-from),0,1);
  return t*t*(3-2*t);
}
function idealSheet(awa,rig){
  return clamp(100*(Math.abs(awa)/rad-rig.incidence-rig.closed)/(rig.open-rig.closed),0,100);
}
function setPlayerSheets(boat,awa,easing){
  boat.main=easing?100:autoTrim?idealSheet(awa,rigs.main):Number($("mainTrim").value);
  boat.jib=easing?100:autoTrim?idealSheet(awa,rigs.jib):Number($("jibTrim").value);
}
function updateSail(sail,rig,sheet,awa,windSpeed,lee,dt,flatten=0){
  const windAngle=Math.abs(awa)/rad;
  const limit=rig.closed+(rig.open-rig.closed)*sheet/100;
  // A slack sheet lets the sail align with the wind until it reaches its sheet limit.
  const opening=clamp(windAngle-2,0,limit);
  const incidence=windAngle-opening;
  const broadReach=smoothStep(108,162,windAngle);
  const attached=smoothStep(3,16,incidence)*(1-.83*smoothStep(31,79,incidence));
  const easedForRun=smoothStep(25,rig.open,opening);
  const filling=smoothStep(.35,1.8,windSpeed)*smoothStep(1,13,incidence);
  const flutter=(1-smoothStep(4,15,incidence))*(.83+.17*filling)*smoothStep(.25,2.6,windSpeed);
  const load=filling*(attached*(1-broadReach)+broadReach*(.16+.76*easedForRun));
  const target=opening*rad*lee;
  const response=dt?1-Math.exp(-dt*10):1;
  sail.angle=(sail.angle??target)+(target-(sail.angle??target))*response;
  sail.flutter=(sail.flutter??flutter)+(flutter-(sail.flutter??flutter))*response;
  const camber=filling*(1-.36*smoothStep(28,65,incidence))*(.085+sheet*.00032)*(1-.45*flatten);
  sail.camber=(sail.camber??camber)+(camber-(sail.camber??camber))*response;
  sail.trimState=windSpeed<.45?"Sem pressão":incidence<11?"Panejando":
    broadReach<.36&&incidence>37?"Caçada demais":load<.23?"Pouca pressão":"Cheia";
  const angle=Math.abs(sail.angle);
  sail.thrust=load*(.23+.77*Math.sin(angle));
  sail.sideLoad=load*Math.cos(angle)*lee;
}
function updateStarCrew(boat,wind,twa,dt){
  const stand=smoothStep(126,153,twa);
  boat.starStand=boat.starStand==null?stand:boat.starStand+(stand-boat.starStand)*(1-Math.exp(-dt*2.8));
  const upwind=1-smoothStep(77,127,twa);
  const brace=smoothStep(6.5,17,wind)*upwind*smoothStep(12,35,twa);
  const target=boat.lee*(.19*(1-smoothStep(4,7,wind))-.64*brace);
  const previous=boat.crewOffset;
  const crossing=previous!=null&&previous*target<0;
  const response=dt?1-Math.exp(-dt*(crossing?3.5:2.8)):1;
  boat.crewOffset=previous==null?target:previous+(target-previous)*response;
  const settled=smoothStep(.20,.46,-boat.lee*boat.crewOffset);
  const effort=!boat.i&&holding("Space")?settled*upwind:0;
  boat.extraHike=(boat.extraHike||0)+(effort-(boat.extraHike||0))*(1-Math.exp(-dt*(crossing?10:5)));
  boat.crewHike=smoothStep(.29,.62,Math.abs(boat.crewOffset));
}
function workStarWaves(boat,sea,dt){
  const following=smoothStep(.23,.78,-dot(sea.waveDirection,sea.heading));
  const downwind=smoothStep(135,157,sea.twa);
  const swell=smoothStep(.12,.68,sea.height);
  const speed=smoothStep(.72,2.05,sea.surge);
  const engaged=Boolean(!boat.i&&holding("Space"));
  const effort=engaged?boat.starStand*following*downwind*swell*speed:0;
  const face=smoothStep(.009,.10,-sea.headSlope);
  const bury=smoothStep(.035,.21,sea.bowDrop)*smoothStep(.023,.16,-boat.pitch);
  // Anticipate the face and transfer weight aft before the bow buries.
  const foreTarget=effort*(.72*face-.89*bury);
  const sideTarget=effort*clamp(boat.heel*1.55+boat.rollRate*.18+sea.beamSlope*.85,-.7,.7);
  const response=1-Math.exp(-dt*4.4);
  boat.starFore=(boat.starFore??0)+(foreTarget-(boat.starFore??0))*response;
  boat.starSide=(boat.starSide??0)+(sideTarget-(boat.starSide??0))*response;
  const timing=Math.max(0,boat.starFore);
  const release=Math.max(0,-boat.starFore);
  return {
    surf:.118*effort*face*timing*(1-bury),
    relief:.052*effort*bury*release,
    pitch:-.074*effort*boat.starFore
  };
}
function updateCrew(boat,trueKnots,dt){
  const limit=classes[boatClass].lightWindLimit;
  const windward=smoothStep(limit,limit+1,trueKnots);
  const extension=smoothStep(limit+1,limit+9,trueKnots);
  const engaged=!boat.i && holding("Space");
  const sotoHike=classes[boatClass].ocean && engaged;
  const target=sotoHike?-boat.lee*.54:boat.lee*(.33*(1-windward)-(.33+.21*extension)*windward);
  const response=1-Math.exp(-dt*1.4);
  boat.crewOffset=boat.crewOffset==null?target:boat.crewOffset+(target-boat.crewOffset)*response;
  const onRail=clamp(-boat.lee*boat.crewOffset/.30,0,1);
  const effort=sotoHike?onRail:engaged?windward*onRail:0;
  boat.extraHike=(boat.extraHike||0)+(effort-(boat.extraHike||0))*(1-Math.exp(-dt*4));
  boat.crewHike=clamp((Math.abs(boat.crewOffset)-.33)/.21,0,1);
}
const starRigFields=["outhaul","cunningham","runner"];
function starTrim(wind,twa){
  const deep=smoothStep(105,158,twa);
  const flatten=smoothStep(7,19,wind);
  return {
    outhaul:(.53-.21*smoothStep(2,6,wind)+.65*flatten)*(1-.85*deep),
    cunningham:.88*smoothStep(7,22,wind)*(1-.94*deep),
    runner:(.15+.77*smoothStep(5,22,wind))*(1-.82*deep)
  };
}
function setStarRig(boat,wind,twa){
  const ideal=starTrim(wind,twa);
  const actual=boat.remote?boat.starRig??ideal:boat.i||autoTrim?ideal:
    Object.fromEntries(starRigFields.map(key=>[key,+$("star-"+key).value/100]));
  boat.starRig=actual;
  let error=0;
  for(const key of starRigFields)error+=(actual[key]-ideal[key])**2;
  boat.starTrimEfficiency=Math.exp(-.13*error);
  boat.starDepower=clamp(.44*actual.outhaul+.24*actual.cunningham+.32*actual.runner,0,1);
}
function updateRig(boat,readings,dt){
  const wind=readings.apparent;
  const awa=wrap(wind.from-boat.h);
  // Keep the boom on its side in the small dead band around dead downwind.
  if(Math.abs(awa)<166*rad || Math.abs(Math.sin(awa))>.10){
    boat.lee=-Math.sign(awa)||boat.lee;
  }
  const star=boatClass==="star", twa=Math.abs(wrap(readings.real.from-boat.h))/rad;
  if(classes[boatClass].classic){
    const ideal=24+51*spiRamp(68,172,Math.abs(awa/rad));
    if(!boat.remote)boat.spiSheet=boat.i||autoTrim?ideal:Number($("spiTrim").value);
    const eased=boat.remote?boat.remoteEase:!boat.i&&holding("KeyF");
    if(eased)boat.spiSheet=100;
    updateBrasilSpi(boat,awa/rad,wind.speed/knot,twa,eased,dt);
  }
  if(classes[boatClass].ocean){
    const swan=boatClass==="clubswan36";
    if(boatClass==="tp52"){
      const tension=(boat.runnerLoads||[0,0]).reduce((a,b)=>Math.max(a,b),0);
      const work=Math.abs(tension-(boat.lastRunnerTension??tension))*12+
        Math.abs(boat.main-(boat.lastGroundMain??boat.main))*.08+
        Math.abs((boat.spiTravel??0)-(boat.lastGroundSide??0))*3;
      boat.grindWork=Math.min(1,(boat.grindWork||0)*Math.exp(-2*dt)+work+(boat.spiUp&&boat.spiHoist<1?dt*2:0));
      boat.grindPhase=(boat.grindPhase||0)+dt*7*boat.grindWork;
      boat.lastRunnerTension=tension;boat.lastGroundMain=boat.main;boat.lastGroundSide=boat.spiTravel??0;
    }
    updateRunners(boat,awa,wind.speed/knot,dt);
    updateSotoInventory(boat,readings.real.speed/knot,twa,dt,swan);
    if(swan)updateSwanFoil(boat,twa,readings.real.speed/knot,dt);
    const ideal=sotoIdealSpi(Math.abs(awa/rad));
    if(!boat.remote)boat.spiSheet=boat.i||autoTrim?ideal:Number($("spiTrim").value);
    if(!boat.i&&holding("KeyF"))boat.spiSheet=100;
    updateSotoKite(boat,awa/rad,wind.speed/knot,readings.real.speed/knot,
      boat.remote?!!boat.remoteEase:!boat.i&&holding("KeyF"),dt);
  }
  if(star){
    setStarRig(boat,readings.real.speed/knot,twa);
    updateStarCrew(boat,readings.real.speed/knot,twa,dt);
  }else if(classes[boatClass].classic){
    boat.extraHike=0;boat.crewOffset=.28;boat.crewHike=0;
  }else updateCrew(boat,readings.real.speed/knot,dt);
  const previous=boat.pumpPull||0;
  const easing=!boat.i && holding("KeyF");
  const held=!boat.i && !easing && holding("KeyB");
  const pull=easing?0:clamp(previous+(held?dt/.20:-dt/.18),0,1);
  boat.pumpPull=pull;
  boat.pumpDrive=0;
  if(!star && !classes[boatClass].ocean && !classes[boatClass].classic && pull>previous && dt>0){
    const knots=readings.real.speed/knot;
    const leverage=smoothStep(1,45,boat.main)*smoothStep(125,150,twa);
    const breeze=smoothStep(0,2,knots)*(1-smoothStep(7,12,knots));
    boat.pumpDrive=.15*(pull-previous)/dt*leverage*breeze;
  }
  boat.mainDuringStroke=boat.main-Math.min(boat.main,38)*pull;
  updateSail(boat.mainSail,rigs.main,boat.mainDuringStroke,awa,wind.speed,boat.lee,dt,star?boat.starDepower:0);
  if(classes[boatClass].jibShare){
    boat.pole=!classes[boatClass].ocean && !classes[boatClass].classic && twa>=(star?(boat.pole?149:157):(boat.pole?161:165));
    updateSail(boat.jibSail,rigs.jib,boat.jib,awa,wind.speed,boat.pole?-boat.lee:boat.lee,dt);
    if(classes[boatClass].classic){
      const exposed=brasilGenoaHoist(boat);
      boat.jibSail.sideLoad*=exposed;
      boat.jibSail.thrust*=exposed;
    }
  }
}
// Flat-water reference speeds in knots. The theoretical hull speed is the
// displacement reference; only the reaching/running branch enters planing.
// Estimated flat-water targets, not an official VPP. Rows are TWS, columns are TWA.
const starAngles=[0,32,38,42,50,60,90,120,145,160,175,180];
const starSpeeds=[
  [0,  0,0,0,0,0,0,0,0,0,0,0,0],
  [4,  0,0,.9,1.85,2.25,2.65,3.1,2.95,2.6,2.4,2.2,2.12],
  [8,  0,0,3.6,4.55,4.8,5.1,5.55,5.45,5.25,5.05,4.94,4.8],
  [12, 0,0,4.95,5.75,5.95,6.12,6.62,6.75,6.68,6.6,6.45,6.28],
  [16, 0,0,5.12,5.92,6.14,6.48,7.2,7.9,7.96,7.77,7.42,7.22],
  [22, 0,0,5.19,6.04,6.29,6.78,8.0,9.3,10.1,10.05,9.24,8.74],
  [30, 0,0,5.17,6.07,6.43,7.0,8.9,10.5,11.85,11.72,10.50,9.74]
];
function starPolar(wind,twa){
  let row=1,column=1;
  while(row<starSpeeds.length-1&&wind>starSpeeds[row][0])row++;
  while(column<starAngles.length-1&&twa>starAngles[column])column++;
  const [low,high]=[starSpeeds[row-1],starSpeeds[row]];
  const angle=clamp((twa-starAngles[column-1])/(starAngles[column]-starAngles[column-1]),0,1);
  const breeze=clamp((wind-low[0])/(high[0]-low[0]),0,1);
  const along=values=>values[column]+(values[column+1]-values[column])*angle;
  return along(low)+(along(high)-along(low))*breeze;
}
function polarKnots(spec,wind,twa){
  if(spec.classic){
    // Estimated displacement polar scaled to each classic’s sailing waterline.
    const sailPower=1-Math.exp(-Math.max(0,wind)/6.8);
    const angle=Math.abs(twa);
    const entry=smoothStep(spec.noGo,46,angle);
    const reach=1+.075*Math.sin(angle*rad)-.15*smoothStep(140,180,angle);
    return spec.hullKn*sailPower*reach*entry*(.84+.16*smoothStep(45,85,angle));
  }
  if(spec===classes.clubswan36)return swanSpeed(wind,twa);
  if(spec===classes.tp52)return tp52Speed(wind,twa);
  if(spec===classes.soto40)return sotoSpeed(wind,twa);
  if(spec===classes.star)return starPolar(wind,twa);
  const blend=(a,b,t)=>a+(b-a)*clamp(t,0,1);
  const [low,high]=spec.beatKn;
  const beat=wind<10?low*(Math.max(0,wind)/10)**.72:
    wind<=12?blend(low,high,(wind-10)/2):blend(high,spec.hullKn*1.045,(wind-12)/10);
  const plane=smoothStep(...spec.planeWind,wind);
  const snipe=spec===classes.snipe;
  const runAngle=snipe?174:blend(156,143,plane);
  const run=blend(beat*1.11,spec.planeKn,plane);
  const points=[[0,0],[spec.beat-13,0],[spec.beat-4,beat*.85],[spec.beat,beat],
    [50,beat*1.035],[90,blend(beat*1.14,spec.planeKn*.79,plane)],
    [runAngle,run],[180,run*(snipe?.995:blend(.85,.65,plane))]];
  for(let i=1;i<points.length;i++){
    const [x,y]=points[i], [prev,speed]=points[i-1];
    if(twa<=x)return blend(speed,y,(twa-prev)/(x-prev));
  }
  return points[points.length-1][1];
}
function sailForces(boat,wind,degrees){
  const spec=classes[boatClass];
  const jibShare=spec.jibShare;
  const sideLoad=boat.mainSail.sideLoad*(1-jibShare)+(boat.jibSail.sideLoad||0)*jibShare;
  return {side:wind.speed**2*(spec.area/7.06)*(81.5/spec.crewKg)*smoothStep(4,27,degrees)*sideLoad};
}
function trimEfficiency(sheet,awa,rig){
  const error=(sheet-idealSheet(awa,rig))/100;
  return Math.exp(-6*error*error);
}
function rollTarget(boat,sidePressure,beamSlope){
  const windHeel=clamp(-.014*classes[boatClass].rollResponse*sidePressure,-.60,.60);
  // Positive roll lifts the starboard rail, so weight on that rail gives negative roll.
  const star=boatClass==="star";
  const heel=windHeel*(star?1-.34*boat.starDepower:1)-boat.crewOffset*(star?.19:.38)+
    beamSlope*(star?.58+.14*(boat.starStand??0):1)-(star?.17*(boat.starSide??0):0);
  // Limit the extra righting moment as the boat approaches level.
  const settledStar=star?smoothStep(.28,.53,-boat.lee*boat.crewOffset):1;
  const arm=star?.44:boatClass==="snipe"?.34:.30;
  const correction=Math.min(Math.max(0,-boat.lee*heel),boat.extraHike*settledStar*arm*.38);
  boat.hikeRelief=correction;
  return clamp(heel+boat.lee*correction,-.70,.70);
}
function springMotion(boat,position,rate,target,stiffness,damping,dt){
  boat[rate]+=(stiffness*(target-boat[position])-damping*boat[rate])*dt;
  boat[position]+=boat[rate]*dt;
}
function playerHelm(){
  let command=Number(keys.has("ArrowLeft"))-Number(keys.has("ArrowRight"));
  for(const value of steering.values())command+=value;
  return clamp(command,-1,1);
}
function moveRudder(boat,command,dt){
  boat.rudderAngle+=(command*.56-boat.rudderAngle)*(1-Math.exp(-dt*11));
}
function capsizeMotion(boat,dt){
  const surface=waterSample(course.water,boat.x,boat.y,oceanTime);
  const flow=vector(conditions.currentDir*rad);
  boat.downTime+=dt;
  if(boat.i && boat.downTime>3)boat.righting=true;
  const target=boat.righting?0:boat.downSide*(Math.PI*.50+.035*Math.sin(oceanTime));
  springMotion(boat,"heel","rollRate",target,boat.righting?1.4:5,boat.righting?2.2:3.4,dt);
  // On its side the flotation volume shifts to the immersed gunwale.
  const sideFloat=(boatClass==="snipe"?.27:.22)*Math.sin(boat.heel)**2;
  springMotion(boat,"heave","heaveRate",surface.height+sideFloat,32,8,dt);
  boat.pitch*=Math.exp(-2*dt);
  const decay=Math.exp(-1.4*dt);
  boat.vx*=decay;boat.vy*=decay;boat.waterSpeed=Math.hypot(boat.vx,boat.vy);
  const vx=boat.vx+flow.x*conditions.current,vy=boat.vy+flow.y*conditions.current;
  boat.x+=vx*dt;boat.y+=vy*dt;boat.speed=Math.hypot(vx,vy);
  moveRudder(boat,boat.righting && !boat.i?playerHelm():0,dt);
  while(boat.wake.length && oceanTime-boat.wake[0].stamp>13)boat.wake.shift();
  if(boat.righting){
    // Bear away on the recovery tack so the sail can fill from a standstill.
    const recoveryHeading=windReadings(boat,time).real.from+boat.downSide*68*rad;
    boat.h=wrap(boat.h+wrap(recoveryHeading-boat.h)*(1-Math.exp(-dt*1.4)));
    if(Math.abs(boat.heel)<.15 && Math.abs(boat.rollRate)<.35){
      boat.downSide=0;boat.righting=false;boat.rollRate=0;
      updateRig(boat,windReadings(boat,time),dt);
    }
  }
}
function excessHeel(boat,wind,awa,twa,beamSlope){
  const sn=boatClass==="snipe";
  const sheet=boat.mainDuringStroke;
  const strong=smoothStep(sn?17:15,sn?31:28,wind/knot);
  const broadside=Math.abs(Math.sin(awa));
  const opening=Math.abs(boat.mainSail.angle);
  const loaded=smoothStep(5,36,Math.abs(awa)/rad-opening/rad);
  const lever=strong*loaded*broadside*(1-.65*smoothStep(.25,1.45,opening));
  const leeMoment=-boat.lee*lever*(sn?1.55:1.72)*(1-.56*boat.extraHike);
  // A rolling disturbance can expose a deeply eased sail to reversed flow.
  const deep=smoothStep(150,177,twa)*smoothStep(78,98,sheet);
  const disturbance=clamp(Math.abs(beamSlope)*4+Math.abs(boat.rollRate)*.65+
    Math.abs(boat.rudderAngle)*1.8,0,1);
  const rollMoment=boat.lee*strong*deep*disturbance*(sn?.82:1.85);
  return leeMoment+rollMoment;
}
function simulate(boat, dt){
  if(boat.finish!==null)return;
  if(boat.downSide){capsizeMotion(boat,dt);return;}
  const spec=classes[boatClass], w=conditions, readings=windReadings(boat,time), a=readings.apparent;
  const awa=wrap(a.from-boat.h), degrees=Math.abs(awa/rad);
  const heading=vector(boat.h), lateral=vector(boat.h+Math.PI/2);
  const surge=dot(boatVelocity(boat),heading), side=dot(boatVelocity(boat),lateral);
  const target=course.targets[boat.stage];
  const atStart=boat.stage===0;
  const line=atStart?course.startLine:target?.gate===course.finishLine?course.finishLine:null;
  const oldFront=line?hullFront(boat,line):null;
  let rudder;
  if(!boat.i){
    rudder=playerHelm();
    setPlayerSheets(boat,awa,holding("KeyF"));
  }else{
    const exit=gateExit(boat,target);
    let aim=guidePoint(boat,target);
    const crossing=target?.gate??exit?.gate;
    if(crossing){
      const {a,normal}=crossing;
      const acrossLine=dot(delta(boat,a),normal);
      if(acrossLine>=0)boat.gateRecovery=true;
      if(acrossLine< -28)boat.gateRecovery=false;
      const lead=boat.gateRecovery?-32:target?.roundingRay?4:exit?7:28;
      aim={x:aim.x+lead*normal.x,y:aim.y+lead*normal.y};
    }
    const role=(boat.i-1)%3;
    const starting=state==="countdown" || boat.stage===0;
    if(starting){
      const gate=course.startLine,mid=course.targets[0].p;
      const tangent={x:-gate.normal.y,y:gate.normal.x};
      const halfWidth=Math.hypot(gate.b.x-gate.a.x,gate.b.y-gate.a.y)/2;
      const lane=boats.length>2?(2*(boat.i-1)/(boats.length-2)-1)*halfWidth*(56/69):0;
      const patrol=lane*.72+12*Math.sin(oceanTime*.12+boat.i*1.7);
      const staging=pending>(role===0?14:role===1?20:17);
      const offset=dot(delta(boat,mid),tangent);
      const tooWide=Math.abs(offset)>halfWidth-4&&hullFront(boat).distance>-10;
      const wrongSide=boat.gateRecovery||boat.mustReturn||tooWide;
      const back=wrongSide?24:state==="running"?-26:staging?34+role*7:Math.max(1.7,pending*1.3-3);
      const position=staging?patrol:lane;
      aim={x:mid.x+position*tangent.x-back*gate.normal.x,
        y:mid.y+position*tangent.y-back*gate.normal.y};
    }
    if(boat.penalties.length && !boat.penaltyTurning && !boat.mustReturn && !boat.clearToTurn){
      const out=vector(windDirection()*rad+boat.penaltySide*105*rad);
      aim={x:boat.x+out.x*23,y:boat.y+out.y*23};
    }
    const targetBearing=aim?angle(delta(aim,boat)):boat.h;
    const wind=readings.real.from;
    const trueAngle=wrap(targetBearing-wind);
    const diff=aim?delta(aim,boat):{x:0,y:0};
    let desired=targetBearing;
    if(Math.abs(trueAngle)<spec.beat*rad){
      const cross=dot(diff,vector(wind+Math.PI/2));
      const ahead=dot(diff,vector(wind));
      const layline=Math.max(7,ahead*(role===0?.53:role===1?.72:.88));
      const leverage=(role===2?12:5)*boat.penaltySide;
      if(oceanTime>boat.tackAt && (cross*boat.tack< -layline ||
          (role===0 && ahead>30 && cross*boat.tack< -16 && wrap(wind-windDirection()*rad)*boat.tack>3*rad))){
        boat.tack*=-1;
        boat.tackAt=oceanTime+(role===0?4:role===1?6:8);
      }
      if(ahead>90 && Math.abs(cross)<12 && !boat.tackAt)boat.tack=Math.sign(leverage);
      desired=wind+boat.tack*(spec.beat+(role===0?0:role===1?4:2))*rad;
    }else if(!starting && spec===classes.clubswan36 && Math.abs(trueAngle)>150*rad){
      const gybe=Math.sign(trueAngle)||boat.tack;
      desired=wind+gybe*(140+7*smoothStep(10,20,readings.real.speed/knot))*rad;
    }else if(!starting && Math.abs(trueAngle)>151*rad && boatClass==="ilca" && role!==1){
      desired=wind+(Math.sign(trueAngle)||boat.tack)*(role===0?150:158)*rad;
    }
    if(boat.avoidance){
      desired=boat.avoidance.heading;
      const escapeAngle=wrap(desired-wind);
      if(Math.abs(escapeAngle)<(spec.beat+3)*rad)
        desired=wind+Math.sign(escapeAngle||boat.penaltySide)*(spec.beat+4)*rad;
    }
    rudder=-clamp(wrap(desired-boat.h)*2.6,-1,1);
    if(boat.penaltyTurning&&!boat.avoidance)rudder=boat.penaltySide;
    boat.main=idealSheet(awa,rigs.main);
    boat.jib=idealSheet(awa,rigs.jib);
  }
  rudder=clamp(rudder,-1,1);
  moveRudder(boat,rudder,dt);
  updateRig(boat,readings,dt);
  const {side:sidePressure}=sailForces(boat,a,degrees);
  const surface=waterSample(course.water,boat.x,boat.y,oceanTime);
  const halfSpan=spec.waveSpan;
  const bow=waterSample(course.water,boat.x+heading.x*halfSpan,boat.y+heading.y*halfSpan,oceanTime);
  const stern=waterSample(course.water,boat.x-heading.x*halfSpan,boat.y-heading.y*halfSpan,oceanTime);
  const floatHeight=(bow.height+2*surface.height+stern.height)/4+(boat.foilLift||0)*.55;
  const headSlope=(bow.height-stern.height)/(2*halfSpan);
  const beamSlope=surface.slopeX*lateral.x+surface.slopeZ*lateral.y;
  const waveDirection=vector(w.waveDir*rad);
  const headSea=Math.max(0,dot(waveDirection,heading));
  const twa=Math.abs(wrap(readings.real.from-boat.h))/rad;
  const star=spec===classes.star;
  const work=star?workStarWaves(boat,{heading,waveDirection,twa,height:w.wave,surge,headSlope,beamSlope,
    bowDrop:surface.height-bow.height},dt):null;
  const waveDrag=clamp(w.wave*.14*headSea+Math.max(0,headSlope)*1.3-(work?.relief??0),0,.48);
  const jibShare=spec.jibShare;
  const exposed=spec.classic?brasilGenoaHoist(boat):1;
  const trim=trimEfficiency(boat.mainDuringStroke,awa,rigs.main)*(1-jibShare)+
    jibShare*(trimEfficiency(boat.jib,awa,rigs.jib)*exposed+(1-exposed)*(boat.spiFill||0));
  const heelTarget=rollTarget(boat,sidePressure,beamSlope);
  const efficiency=spec.classic?1:1+.025*clamp(boat.hikeRelief/.13,0,1);
  const starBalance=star?(boat.starTrimEfficiency??1)*(1-.17*smoothStep(.27,.66,Math.abs(boat.heel))):1;
  const inventory=spec.ocean?sotoSailFactor(boat,readings.real.speed/knot,twa,spec===classes.clubswan36):1;
  const classicDrive=spec.classic?1+.19*boat.spiFill*boat.spiHoist*smoothStep(75,143,twa):1;
  const targetSpeed=classicDrive*inventory*knot*polarKnots(spec,readings.real.speed/knot,twa)*trim*efficiency*starBalance;
  const surf=smoothStep(110,145,twa)*smoothStep(...spec.planeWind,readings.real.speed/knot)*
    clamp(-headSlope,0,.25)*w.wave*.12+(work?.surf??0);
  const resistance=v=>spec.drag*v*Math.abs(v)+.034*v;
  const surplus=resistance(targetSpeed)*(1-waveDrag*(1-(boat.foilLift||0)))+surf-resistance(surge);
  const longitudinal=(boat.pumpDrive+surplus*(surplus>0?2.15:1)-
    .047*Math.abs(rudder)*surge)/spec.inertia;
  const kiteSide=spec.classic?.40*boat.spiSide:spec.ocean?boat.spiSide:0;
  const lateralForce=-(boat.foilSide||0)*.18+.30*kiteSide+.0014*sidePressure-side*(.6+.39*Math.abs(surge))*(star?1.8:1);
  boat.vx+=(heading.x*longitudinal+lateral.x*lateralForce)*dt;
  boat.vy+=(heading.y*longitudinal+lateral.y*lateralForce)*dt;
  const helm=boat.rudderAngle/.56;
  // Progressively tighten the turn as the tiller approaches full travel.
  const turnGain=.565+.30*helm*helm;
  const weatherHelm=star?-.24*boat.lee*smoothStep(.29,.72,Math.abs(boat.heel))*smoothStep(.55,1.8,surge):0;
  const gripLoss=spec.ocean?smoothStep(.37,.87,Math.abs(boat.heel))*smoothStep(.08,.9,boat.spiLoad):0;
  const kiteYaw=kiteSide*(.11*(1-(boat.spiFill||0))-.26*gripLoss*smoothStep(.35,1.6,surge));
  boat.h=wrap(boat.h+(-helm*turnGain*(1-.66*gripLoss)*clamp(surge/1.65,-1,1)*spec.turn+weatherHelm+kiteYaw)*dt);
  springMotion(boat,"heave","heaveRate",floatHeight,46,9.8,dt);
  springMotion(boat,"pitch","pitchRate",clamp(headSlope+(work?.pitch??0),-.36,.36),31,8.3,dt);
  const overload=excessHeel(boat,a.speed,awa,twa,beamSlope)*(star?.39*(1-.54*boat.starDepower):1);
  const heelGoal=spec.classic?clamp(-.008*sidePressure+.42*beamSlope-.10*kiteSide,-.48,.48):spec.ocean?clamp(heelTarget+.19*overload-.42*kiteSide,-.97,.97):star?clamp(heelTarget+overload,-.84,.84):heelTarget+overload;
  springMotion(boat,"heel","rollRate",heelGoal,9/spec.inertia,star?2.7:3.8,dt);
  if(!star&&!spec.ocean&&!spec.classic&&Math.abs(boat.heel)>(boatClass==="snipe"?57:54)*rad){
    boat.downSide=Math.sign(boat.heel);boat.downTime=0;boat.righting=false;
    boat.pumpPull=0;boat.pumpDrive=0;return;
  }
  const flow=vector(w.currentDir*rad);
  const old={x:boat.x,y:boat.y};
  boat.x+=(boat.vx+flow.x*w.current+clamp(surface.vx*.34,-.40,.40))*dt;
  boat.y+=(boat.vy+flow.y*w.current+clamp(surface.vz*.34,-.40,.40))*dt;
  boat.speed=distance(boat,old)/dt;
  boat.waterSpeed=Math.hypot(boat.vx,boat.vy);
  if(oceanTime>=boat.trackAt){
    boat.wake.push({x:boat.x,y:boat.y,h:boat.h,speed:boat.waterSpeed,stamp:oceanTime});
    boat.trackAt=oceanTime+.16;
  }
  while(boat.wake.length&&oceanTime-boat.wake[0].stamp>13)boat.wake.shift();
  if(state!=="running"||boat.penaltyTurning)return;
  let crossedStart=false;
  if(atStart){
    const front=hullFront(boat);
    if(boat.mustReturn && front.distance<0)boat.mustReturn=false;
    crossedStart=!boat.mustReturn && crossed(oldFront.point,front.point,course.startLine);
    if(crossedStart){boat.ocs=false;boat.tackAt=0;}
  }
  const lastLeg=boat.stage===course.targets.length-1;
  if(target&&(!lastLeg||!boat.penalties.length)&&(atStart?crossedStart:lastLeg?crossed(oldFront.point,hullFront(boat,line).point,line):passed(old,boat,target))){
    const exits=course.targets[boat.stage+1]?.exits;
    if(exits){
      const difference=distance(boat,exits[0].p)-distance(boat,exits[1].p);
      boat.gateSide=difference < (boat.i%3-1)*12?0:1;
    }
    boat.gateRecovery=false;
    boat.stage++;
    if(boat.stage===course.targets.length)boat.finish=time;
  }
}
const boatVelocity=b=>({x:b.vx,y:b.vy});
function gateExit(boat,target){
  if(!target?.exits)return null;
  if(boat.i&&boat.gateSide!==undefined)return target.exits[boat.gateSide];
  const [left,right]=target.exits;
  return distance(boat,left.p)<distance(boat,right.p)?left:right;
}
function guidePoint(boat,target){
  return gateExit(boat,target)?.p??target?.p;
}
function passed(old,boat,target){
  if(target.exits)return target.exits.some(exit=>crossed(old,boat,exit.gate));
  if(!target.gate)return distance(boat,target.p)<(target.radius??18);
  return crossed(old,boat,target.gate);
}
function crossed(old,boat,{a,b,normal}){
  const before=dot(delta(old,a),normal), after=dot(delta(boat,a),normal);
  if(before>=0||after<0)return false;
  const t=-before/(after-before);
  const hit={x:old.x+(boat.x-old.x)*t,y:old.y+(boat.y-old.y)*t};
  const length=delta(b,a);
  const position=dot(delta(hit,a),length)/dot(length,length);
  return position>=0&&position<=1;
}
const canvas=$("map"), ctx=canvas.getContext("2d");
const sceneCanvas=$("sea3d");
const scene=createSailingScene(sceneCanvas);
let tactical=!scene;
let viewWidth=0,viewHeight=0;
new ResizeObserver(entries=>{
  const {width,height}=entries[0].contentRect, pixelRatio=Math.min(devicePixelRatio,2);
  canvas.width=Math.round(width*pixelRatio);canvas.height=Math.round(height*pixelRatio);
  viewWidth=width;viewHeight=height;
  ctx.setTransform(pixelRatio,0,0,pixelRatio,0,0);
}).observe(canvas.parentElement);
const coast=[
  [[-4500,-5000],[4200,-5000],[3330,-2700],[3040,-2460],[2670,-2080],[2360,-1590],[2080,-1310],[1730,-1260],[1550,-1400],[1220,-1610],[800,-1670],[430,-1705],[0,-1710],[-440,-1710],[-800,-1650],[-1210,-1530],[-1460,-1430],[-1720,-1220],[-1910,-1230],[-2140,-1090],[-2250,-850],[-2480,-740],[-2710,-780],[-2810,-990],[-3180,-1010],[-3580,-840],[-4500,-620]],
  [[4400,-3550],[5000,-2000],[5000,2250],[3970,2100],[3590,1820],[3420,1690],[3270,1320],[3200,1020],[3110,745],[3200,490],[3250,170],[3190,-170],[2970,-520],[2780,-665],[2690,-730],[2670,-785],[2770,-850],[3420,-1110],[3640,-1490],[3540,-1940],[3600,-2380]],
  [[-4900,-270],[-4040,-260],[-3670,-55],[-3430,260],[-3390,650],[-3510,1100],[-3260,1440],[-3470,1820],[-3930,1940],[-4900,1750]]
];
const alternateCoast={
  canas:[[[658,-441],[726,-553],[1390,-832],[2590,-1240],[3280,2920],[1760,3050],
    [970,990],[820,655],[695,429],[592,327],[517,213],[487,180],[463,168],[438,145],[431,121],
    [440,96],[464,81],[497,65],[537,-22],[569,-116],[606,-248]]],
  rio:[[[-3000,-2800],[-1010,-1710],[-800,-1080],[-559,-780],[-690,-383],[-789,310],
    [-1000,555],[-1240,1030],[-1240,1600],[-1430,2050],[-1690,2550],[-2070,2930],
    [-1660,3130],[-1240,3230],[-1020,3335],[-690,3400],[-248,3400],[25,3290],
    [225,3370],[352,3550],[350,3700],[132,3830],[-280,3880],[-723,3930],[-1000,4170],[-3000,4720]],
    [[2640,1370],[2630,2140],[3020,2790],[3600,2950],[4370,3590],[5400,3910],[7100,1520],[6800,-1150]]]
};
const alternatePlaces={
  canas:[[460,110,"Farolete"],[550,130,"Casa da Ponta das Canas"],[1150,460,"Ilhabela"]],
  rio:[[-520,-245,"Aeroporto Santos Dumont"],[-610,3660,"Morro da Urca"],[118,3555,"Pão de Açúcar"],[-1240,1020,"Marina da Glória"],[-5190,5820,"Corcovado"]]
};
const places=[[-2300,-1140,"Ilha Porchat"],[-1400,-1730,"José Menino"],[-560,-1940,"Gonzaga"],[514,-1763,"Basílica do Embaré"],[2130,-1550,"Ponta da Praia"],[3400,890,"Guarujá"]];
const ripples=Array.from({length:165},(_,i)=>[(i*.61803398875)%1,(i*.755123)%1,(i*.4385)%1]);
function segment(a,b,color,width,dash=[]){
  ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.beginPath();
  ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.setLineDash([]);
}
function label(value,x,y,color="#e1efde",size=11){
  ctx.font="600 "+size+"px ui-monospace, monospace";ctx.fillStyle=color;ctx.fillText(value,x,y);
}
function draw(){
  const w=viewWidth,h=viewHeight;
  if(!w||!h)return;
  const local=Math.min(w/530,h/480);
  const scale=zoom?Math.min(w/7300,h/4900):local;
  const origin={x:w*.5,y:h*(zoom?.52:.53)};
  const offset=zoom?{x:0,y:-250}:{
    x:boats[0].x-clamp(boats[0].x-course.venue.x,-190,190),
    y:boats[0].y-clamp(boats[0].y-course.venue.y,-165,165)
  };
  const project=(x,y)=>({x:origin.x+(x-offset.x)*scale,y:origin.y+(y-offset.y)*scale});
  const px=p=>project(p.x,p.y);
  const ocean=ctx.createLinearGradient(0,0,w,h);
  ocean.addColorStop(0,"#24565a");ocean.addColorStop(.52,"#19464d");ocean.addColorStop(1,"#102f3c");
  ctx.fillStyle=ocean;ctx.fillRect(0,0,w,h);
  const grid=zoom?1000:50;
  const left=offset.x-origin.x/scale,top=offset.y-origin.y/scale;
  for(let x=Math.floor(left/grid)*grid;x<left+w/scale;x+=grid){
    const sx=project(x,0).x;
    segment({x:sx,y:0},{x:sx,y:h},"#a9d9dc20",1);
  }
  for(let y=Math.floor(top/grid)*grid;y<top+h/scale;y+=grid){
    const sy=project(0,y).y;
    segment({x:0,y:sy},{x:w,y:sy},"#a9d9dc20",1);
  }
  const wave=vector((conditions.waveDir+90)*rad), propagation=vector((conditions.waveDir+180)*rad);
  for(const [a,b,c] of ripples){
    const shift=oceanTime*(2+Math.min(conditions.wave,2)*3);
    const x=((a*w+propagation.x*shift)%w+w)%w,y=((b*h+propagation.y*shift)%h+h)%h;
    const size=3+c*15;
    segment({x,y},{x:x+wave.x*size,y:y+wave.y*size},c>.8?"#baddd74d":"#baddd720",1);
  }
  for(const shape of course.venue.scenery==="santos"?coast:alternateCoast[course.venue.scenery]){
    ctx.beginPath();
    shape.forEach(([x,y],i)=>{const p=project(x,y);if(!i)ctx.moveTo(p.x,p.y);else ctx.lineTo(p.x,p.y);});
    ctx.closePath();ctx.fillStyle="#405b51";ctx.fill();ctx.strokeStyle="#95ad83";ctx.lineWidth=2;ctx.stroke();
  }
  if(zoom){
    for(const [x,y,name] of course.venue.scenery==="santos"?places:alternatePlaces[course.venue.scenery]){
      const p=project(x,y);label(name,p.x,p.y,"#ecf2d8",10);
    }

  }else{
    label(tr(course.venue.name).toUpperCase()+"  ·  "+course.venue.region.toUpperCase(),18,74,"#bdd7d2",10);
  }
  const start=course.startLine;
  const middle={x:(start.a.x+start.b.x)/2,y:(start.a.y+start.b.y)/2};
  if(!zoom)segment(px(middle),px(course.marks[0]),"#cee9e037",1,[4,6]);
  for(const [line,title,color] of [
    [start,"LARGADA","#eac884"],[course.leewardGate,"","#f4a06d"],[course.finishLine,"CHEGADA","#aadb91"]
  ]){
    const active=line===course.targets[boats[0].stage]?.gate;
    const a=px(line.a),b=px(line.b);
    segment(a,b,active?"#e0fc81":color,active?2:1,[5,4]);
    for(const p of (line.committee?[px(line.pin)]:[a,b])){
      ctx.fillStyle=active?"#e0fc81":color;ctx.beginPath();ctx.arc(p.x,p.y,3.5,0,2*Math.PI);ctx.fill();
    }
    if(line.committee){
      const cr=px(line.committee);
      ctx.fillStyle="#f7f1df";ctx.beginPath();
      ctx.moveTo(cr.x-6,cr.y+3);ctx.lineTo(cr.x-6,cr.y-3);ctx.lineTo(cr.x+3,cr.y-3);
      ctx.lineTo(cr.x+7,cr.y);ctx.lineTo(cr.x+3,cr.y+3);ctx.closePath();ctx.fill();
      label(tr("CR"),cr.x+7,cr.y-4,"#fff4cd",10);
    }
    if(!zoom&&title)label(tr(title),Math.min(a.x,b.x),Math.max(a.y,b.y)+14,"#bbd5c9",9);
  }
  for(const mark of course.channelMarks){
    const p=px(mark);ctx.fillStyle=mark.red?"#fb6859":"#67d397";
    ctx.fillRect(p.x-2,p.y-2,4,4);label("BL "+mark.id,p.x+5,p.y,ctx.fillStyle,9);
  }
  if(course.venue.scenery==="santos"){
  const fort=project(2690,-756);ctx.fillStyle="#f6d795";ctx.fillRect(fort.x-3,fort.y-3,6,6);label("Fortaleza da Barra",fort.x-108,fort.y-7,"#f6d795",10);
  const pier=project(2025,-1269);label("Deck do Pescador",pier.x,pier.y,"#e1dfbd",10);
  }
  course.marks.forEach(mark=>{
    const p=px(mark);
    ctx.beginPath();ctx.arc(p.x,p.y,zoom?4:7,0,2*Math.PI);
    ctx.fillStyle="#f4a06d";ctx.fill();ctx.strokeStyle="#203135";ctx.lineWidth=2;ctx.stroke();
    if(!zoom)label(mark.label,p.x+10,p.y+4,"#ffc49c",11);
  });
  const next=course.targets[boats[0].stage];
  if(next){
    const p=px(guidePoint(boats[0],next)),o=px(boats[0]);
    segment(o,p,"#e0fc8180",1,[4,5]);
    ctx.beginPath();ctx.arc(p.x,p.y,zoom?5:11,0,2*Math.PI);ctx.strokeStyle="#ddf881";ctx.stroke();
  }
  for(const boat of boats.slice().reverse()){
    if(boat.offline)continue;
    const p=px(boat);
    if(!zoom){
      boat.wake.forEach((spot,i)=>{
        if(!i)return;
        segment(px(boat.wake[i-1]),px(spot),"rgba(205,242,239,"+(i/boat.wake.length*.32)+")",1.4);
      });
    }
    ctx.save();ctx.translate(p.x,p.y);ctx.rotate(boat.h);ctx.scale(zoom?.52:1,zoom?.52:1);
    ctx.shadowColor="#07171e";ctx.shadowBlur=5;
    ctx.beginPath();ctx.moveTo(0,-14);ctx.quadraticCurveTo(8,-6,6,10);ctx.lineTo(-6,10);ctx.quadraticCurveTo(-8,-6,0,-14);ctx.fillStyle=boat.i?boat.color:classes[boatClass].hull;ctx.fill();ctx.strokeStyle="#142729";ctx.lineWidth=1.4;ctx.stroke();ctx.shadowBlur=0;
    const boom=-boat.mainSail.angle;
    ctx.save();ctx.rotate(boom+boat.heel*.2);ctx.beginPath();ctx.moveTo(0,-3);ctx.quadraticCurveTo(5,2,2,13);ctx.lineTo(-2,13);ctx.closePath();ctx.fillStyle=boat.color;ctx.fill();ctx.strokeStyle="#263d33";ctx.lineWidth=.65;ctx.stroke();ctx.restore();
    if(classes[boatClass].jibShare && (!classes[boatClass].classic||brasilGenoaHoist(boat)>.05))segment({x:0,y:-11},{x:Math.sin(boat.jibSail.angle)*9,y:-3},boat.color,2);
    ctx.restore();
    if(!zoom)label(onlineRace?boat.name:tr(boat.name),p.x+12,p.y-7,boat.color,10);
    if(boat.penalties.length)label("⚐ "+boat.penalties[0].turns*360+"°",p.x+11,p.y+7,"#ffbc94",10);
  }
  if(!zoom){
    const player=boats[0],incoming=apparent(player,time);
    if(!player.downSide&&incoming.speed>.12){
      const bow=vector(player.h),from=vector(incoming.from),spot=px(player);
      const tip={x:spot.x+bow.x*17,y:spot.y+bow.y*17};
      const tail={x:tip.x+from.x*28,y:tip.y+from.y*28};
      segment(tail,tip,"#72eaff",2);
      for(const offset of [-.55,.55]){
        const wing=vector(incoming.from+offset);
        segment(tip,{x:tip.x+wing.x*8,y:tip.y+wing.y*8},"#72eaff",2);
      }
    }
  }
  const compass={x:w-38,y:92};
  ctx.beginPath();ctx.arc(compass.x,compass.y,20,0,2*Math.PI);ctx.fillStyle="#143137";ctx.fill();ctx.strokeStyle="#739794";ctx.stroke();
  label("N",compass.x-3,compass.y-26,"#d6e6df",10);
  const wind=vector((windDirection()+180)*rad);
  const tip={x:compass.x+wind.x*13,y:compass.y+wind.y*13};
  segment({x:compass.x-wind.x*12,y:compass.y-wind.y*12},tip,"#ddf881",2);
  for(const a of [-.6,.6]){
    const feather=vector((windDirection()+180)*rad+a);
    segment(tip,{x:tip.x-feather.x*7,y:tip.y-feather.y*7},"#ddf881",2);
  }
  const metres=zoom?1000:50, x=18,y=h-42;
  segment({x,y},{x:x+metres*scale,y},"#bbd5c9",1.5);
  label(zoom?"1 km":"50 m",x,y+15,"#bbd5c9",10);
}
document.addEventListener("visibilitychange",()=>{if(document.hidden&&ambience)ambience(boats[0],false);});
function reset(){
  onlineRace=null;
  $("sailor-tags").replaceChildren();
  releaseHelm();
  clearTouchActions();
  keys.delete("KeyF");keys.delete("KeyB");keys.delete("Space");keys.delete("KeyP");
  document.body.className="setup-screen";
  state="idle";loadConditions();setup();showWeather();
}
$("spi-toggle").onclick=()=>{const b=boats[0];if((classes[boatClass].ocean||classes[boatClass].classic)&&b)b.spiUp=!b.spiUp;};
$("soto-jib").onchange=()=>{const b=boats[0];if(!b)return;b.jibManual=Number($("soto-jib").value);if(b.jibManual)b.jibNumber=b.jibManual;else b.jibNumber=0;};
$("swan-jib").onchange=()=>{
  const b=boats[0];
  if(b && boatClass==="clubswan36"){b.jibManual=Number($("swan-jib").value);b.jibNumber=b.jibManual;}
};
function showClassControls(){
  $("swan-jib").hidden=boatClass!=="clubswan36";
  const classic=!!classes[boatClass].classic;
  $("hike-action").hidden=classic;
  $("soto-jib").hidden=classic||boatClass==="clubswan36";
  $("soto-controls").hidden=!(classes[boatClass].ocean||classic);
  $("spiLabel").hidden=!(classes[boatClass].ocean||classic);
  $("jibLabel").hidden=!classes[boatClass].jibShare;
  $("star-trim").hidden=boatClass!=="star";
}
function select(name){
  boatClass=name;
  for(const key of Object.keys(classes))$(key).setAttribute("aria-pressed",String(key===name));
  showClassControls();
  $("mainTrim").value=27;$("jibTrim").value=30;$("spiTrim").value=50;
  reset();
}
$("sky-choice").onchange=()=>{document.body.dataset.sky=$("sky-choice").value;};
for(const name of Object.keys(classes))$(name).onclick=()=>select(name);
$("refresh").onclick=updateWeather;
let cockpitView=false, sideView=false, orbitYaw=0, orbitActive=false;
let orbitPointer=null, orbitX=0;
function resetOrbit(){
  if(orbitPointer!==null && sceneCanvas.hasPointerCapture(orbitPointer))
    sceneCanvas.releasePointerCapture(orbitPointer);
  orbitPointer=null;orbitYaw=0;orbitActive=false;
  $("boat-view").textContent=sideView?((classes[boatClass].ocean||classes[boatClass].classic)?tr("Ver cockpit"):tr("Vista de popa")):cockpitView?tr("Vista de popa"):tr("Vista lateral");
}
sceneCanvas.addEventListener("pointerdown",e=>{
  if(orbitPointer!==null||e.button!==0||tactical)return;
  orbitPointer=e.pointerId;orbitX=e.clientX;
  sceneCanvas.setPointerCapture(e.pointerId);
});
sceneCanvas.addEventListener("pointermove",e=>{
  if(e.pointerId!==orbitPointer)return;
  const dx=e.clientX-orbitX;
  if(!dx)return;
  orbitYaw=(orbitYaw-dx*2*Math.PI/Math.max(240,sceneCanvas.clientWidth))%(2*Math.PI);
  orbitX=e.clientX;orbitActive=true;
  $("boat-view").textContent=tr("Vista de popa");
});
for(const type of ["pointerup","pointercancel","lostpointercapture"])
  sceneCanvas.addEventListener(type,e=>{if(e.pointerId===orbitPointer)orbitPointer=null;});
function setView(map){
  tactical=map;
  canvas.hidden=!map;
  sceneCanvas.hidden=map;
  $("zoom").setAttribute("aria-pressed",String(map));
  $("zoom").setAttribute("aria-label",map?tr("Voltar à vista 3D"):tr("Abrir carta tática"));
  $("map-note").hidden=!map;
  $("boat-view").hidden=map||!scene;
}
setView(tactical);
if(!scene){
  $("zoom").setAttribute("aria-label",tr("Alternar escala da carta"));
  $("map-note").hidden=true;
}
$("zoom").onclick=()=>{
  if(scene){zoom=false;setView(!tactical);}
  else zoom=!zoom;
};
$("boat-view").onclick=()=>{
  const nextCockpit=!orbitActive && sideView && (classes[boatClass].ocean||classes[boatClass].classic);
  sideView=!orbitActive && !sideView && !cockpitView;
  cockpitView=nextCockpit;
  resetOrbit();
  $("boat-view").setAttribute("aria-pressed",String(sideView));
  $("boat-view").textContent=sideView?((classes[boatClass].ocean||classes[boatClass].classic)?tr("Ver cockpit"):tr("Vista de popa")):cockpitView?tr("Vista de popa"):tr("Vista lateral");
  setView(false);
};
$("zoom").addEventListener("contextmenu",event=>event.preventDefault());
function prepareAudio(){
  if(!audioCtx && window.AudioContext)audioCtx=new AudioContext();
  if(audioCtx&&!ambience)ambience=seaAudio(audioCtx);
  if(audioCtx?.state==="suspended")audioCtx.resume().catch(()=>{});
}
function enterRace(clock){
  sideView=false;cockpitView=false;resetOrbit();$("boat-view").setAttribute("aria-pressed","false");
  state="countdown";
  pending=prestartSeconds;
  startAt=clock;
  if(windShiftsEnabled&&!onlineRace)windShift=nextWindShift(0,oceanTime);
  document.body.className="sailing";
  showWeather();hud();
}
$("start").onclick=()=>{
  prepareAudio();
  loadConditions();setup();enterRace(performance.now()+prestartSeconds*1000);
};

const snapshotFields=["x","y","h","vx","vy","speed","waterSpeed","heel","pitch","heave",
  "rudderAngle","downSide","stage","main","jib","extraHike"];
function playerSnapshot(){
  const b=boats[0];
  return {
    ...Object.fromEntries(snapshotFields.map(key=>[key,b[key]??0])),
    mainAngle:b.mainSail.angle??0,jibAngle:b.jibSail.angle??0,crewPose:b.crewOffset??0,
    finish:b.finish,starRig:b.starRig,
    soto:(classes[boatClass].ocean||classes[boatClass].classic)?{jib:b.jibNumber||1,spi:Number(!!b.spiUp),ease:Number(holding("KeyF")),sheet:b.spiSheet??50}:undefined,
    starMotion:boatClass==="star"?{stand:b.starStand??0,fore:b.starFore??0,side:b.starSide??0}:undefined
  };
}
function startOnline(room,clock){
  const options=room.settings;
  onlineRace={previous:{
    venue:$("venue").value, sky:$("sky-choice").value, boatClass, windShiftsEnabled
  }, start:clock};
  let seed=Array.from(room.code).reduce((sum,key)=>Math.imul(sum,31)+key.charCodeAt(0)|0,17);
  onlineRace.random=()=>{
    seed=(Math.imul(seed,1664525)+1013904223)|0;
    return (seed>>>0)/4294967296;
  };
  $("venue").value=options.venue;
  $("sky-choice").value=options.sky==="rain"?"cloudy":options.sky;
  document.body.dataset.sky=$("sky-choice").value;
  boatClass=options.boatClass;
  showClassControls();
  windShiftsEnabled=options.windShift;
  conditions={...options.weather,count:0,windOK:true,waveOK:true,tideOK:true,flowOK:true};
  const me=room.players.find(player=>player.id===room.id);
  setup([me,...room.players.filter(player=>player!==me)]);
  oceanTime=Math.max(0,(performance.now()-clock)/1000+prestartSeconds);
  if(windShiftsEnabled)windShift=nextWindShift(0,0,onlineRace.random);
  for(const boat of boats){
    const tag=document.createElement("span");
    tag.className="sailor-tag";
    tag.textContent=boat.name;
    tag.hidden=true;
    $("sailor-tags").append(tag);
    boat.tag=tag;
  }
  setView(!scene);
  enterRace(clock);
}
function receiveFleet(players){
  for(const boat of boats){
    if(!boat.remote)continue;
    const player=players.find(member=>member.id===boat.onlineId);
    boat.offline=!player?.online;
    if(player?.boat){boat.snapshot=player.boat;boat.received=performance.now();}
  }
}
function moveRemote(b,dt,stamp){
  const s=b.snapshot;
  if(!s||b.offline)return;
  const smooth=1-Math.exp(-dt*12), prediction=clamp((stamp-b.received)/1000+.13,0,.4);
  b.x+=(s.x+s.vx*prediction-b.x)*smooth;
  b.y+=(s.y+s.vy*prediction-b.y)*smooth;
  b.h=wrap(b.h+wrap(s.h-b.h)*smooth);
  for(const key of ["heel","pitch","heave","rudderAngle","extraHike"]){
    b[key]= (b[key]||0)+(s[key]-(b[key]||0))*smooth;
  }
  for(const key of ["speed","waterSpeed","vx","vy","downSide","stage","main","jib","finish"])b[key]=s[key];
  const hike=b.extraHike;
  if(s.soto){b.jibNumber=s.soto.jib;b.spiUp=!!s.soto.spi;b.remoteEase=!!s.soto.ease;b.spiSheet=s.soto.sheet;}
  if(s.starRig)b.starRig=s.starRig;
  updateRig(b,windReadings(b,time),dt);
  b.extraHike=hike;
  b.crewOffset=s.crewPose;
  if(boatClass==="star"){
    b.crewHike=smoothStep(.29,.62,Math.abs(b.crewOffset));
    if(s.starMotion){
      b.starStand+=(s.starMotion.stand-b.starStand)*smooth;
      b.starFore=(b.starFore??0)+(s.starMotion.fore-(b.starFore??0))*smooth;
      b.starSide=(b.starSide??0)+(s.starMotion.side-(b.starSide??0))*smooth;
    }
  }
  b.mainSail.angle=s.mainAngle;
  if(classes[boatClass].jibShare)b.jibSail.angle=s.jibAngle;
  if(oceanTime>=b.trackAt){
    b.wake.push({x:b.x,y:b.y,h:b.h,speed:b.waterSpeed,stamp:oceanTime});
    b.trackAt=oceanTime+.16;
  }
  while(b.wake.length&&oceanTime-b.wake[0].stamp>13)b.wake.shift();
}
function leaveOnline(){
  const previous=onlineRace?.previous;
  multiplayer.leave();
  if(!previous)return;
  $("venue").value=previous.venue;
  $("sky-choice").value=previous.sky;
  document.body.dataset.sky=previous.sky;
  boatClass=previous.boatClass;
  windShiftsEnabled=previous.windShiftsEnabled;
  showClassControls();
  $("venue").onchange();
}
const multiplayer=createRoomClient({
  getSettings:()=>({venue:$("venue").value,boatClass,sky:$("sky-choice").value,windShift:windShiftsEnabled,weather:conditions}),
  getBoat:playerSnapshot, onRace:startOnline, onFleet:receiveFleet,
  onClosed:message=>{if(onlineRace)returnToSetup(); multiplayer.message(message);},
  prepareAudio,
  describe:options=>tr(venues[options.venue].name)+" · "+classes[options.boatClass].name+" · "+
    fmt(options.weather.wind,1)+" Kts · "+[...$("sky-choice").options].find(option=>option.value===(options.sky==="rain"?"cloudy":options.sky)).textContent
});
const raceMenu=$("race-menu"), starRigDialog=$("star-rig");
$("star-trim").onclick=()=>{
  keys.clear();steering.clear();releaseHelm();clearTouchActions();
  updateStarRigPanel(boats[0]);
  starRigDialog.showModal();
};
for(const key of starRigFields){
  const input=$("star-"+key);
  input.addEventListener("input",()=>{$("star-"+key+"-value").textContent=input.value+"%";});
}
function updateStarRigPanel(boat){
  $("star-rig-mode").textContent=autoTrim?tr("Trimagem automática ativa."):tr("Ajuste manual.");
  for(const key of starRigFields){
    const input=$("star-"+key);
    input.disabled=autoTrim;
    const percent=autoTrim?Math.round((boat.starRig?.[key]??0)*100):input.value;
    $("star-"+key+"-value").textContent=percent+"%";
  }
}
function returnToSetup(){
  if(starRigDialog.open)starRigDialog.close();
  if(onlineRace)leaveOnline();
  reset();
  $("start").focus({preventScroll:true});
}
$("exit-race").onclick=()=>{
  if(state==="finished"){returnToSetup();return;}
  keys.clear();
  steering.clear();
  releaseHelm();
  clearTouchActions();
  raceMenu.returnValue="";
  raceMenu.showModal();
};
raceMenu.addEventListener("close",()=>{
  if(raceMenu.returnValue==="exit")returnToSetup();
});
$("map-note").addEventListener("click",()=>{
  if(tactical)zoom=!zoom;
});
function rightBoat(){
  const boat=boats[0];
  if(boat?.downSide && (state==="countdown"||state==="running"))boat.righting=true;
}
$("right-boat").onclick=rightBoat;
const penaltyButton=$("serve-penalty");
penaltyButton.addEventListener("pointerdown",event=>{
  penaltyButton.setPointerCapture(event.pointerId);
  keys.add("KeyP");
});
for(const type of ["pointerup","pointercancel","lostpointercapture","blur"])
  penaltyButton.addEventListener(type,()=>keys.delete("KeyP"));
const controlKeys=["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","KeyQ","KeyE"];
window.addEventListener("keydown",event=>{
  if(raceMenu.open||starRigDialog.open)return;
  if(event.code==="KeyV" && !event.metaKey && !event.ctrlKey && !event.altKey && boats[0]?.downSide){
    event.preventDefault();rightBoat();return;
  }
  if((event.code==="KeyB"||event.code==="KeyF"||event.code==="Space"||event.code==="KeyP") && (state==="running"||state==="countdown")){
    if(event.ctrlKey||event.metaKey||event.altKey||event.target.matches("textarea,select,input:not([type=range])"))return;
    event.preventDefault();
    keys.add(event.code);
    return;
  }
  if(!controlKeys.includes(event.code)||event.ctrlKey||event.altKey||event.metaKey)return;
  if(state!=="countdown"&&state!=="running")return;
  if(event.target.matches?.("textarea,select,input:not([type=range]),[contenteditable=true]"))return;
  event.preventDefault();keys.add(event.code);
});
window.addEventListener("keyup",event=>keys.delete(event.code));
window.addEventListener("blur",()=>{keys.clear();steering.clear();});
for(const button of document.querySelectorAll("[data-turn]")){
  button.addEventListener("pointerdown",event=>{
    button.setPointerCapture(event.pointerId);steering.set(event.pointerId,+button.dataset.turn);
  });
  const release=event=>steering.delete(event.pointerId);
  for(const type of ["pointerup","pointercancel","lostpointercapture"])button.addEventListener(type,release);
  for(const type of ["keydown","keyup"])button.addEventListener(type,event=>{
    if(event.key!=="Enter")return;
    event.preventDefault();
    if(type==="keydown")steering.set(button,+button.dataset.turn);else steering.delete(button);
  });
  button.addEventListener("blur",()=>steering.delete(button));
}
const touchActionButtons=document.querySelectorAll("[data-hold]");
function clearTouchActions(){
  touchActions.clear();
  for(const button of touchActionButtons)button.classList.remove("active");
}
for(const button of touchActionButtons){
  const code=button.dataset.hold;
  button.addEventListener("pointerdown",event=>{
    if(event.button!==0||touchActions.has(code))return;
    button.setPointerCapture(event.pointerId);
    touchActions.set(code,event.pointerId);
    button.classList.add("active");
  });
  for(const type of ["pointerup","pointercancel","lostpointercapture"]){
    button.addEventListener(type,event=>{
      if(touchActions.get(code)!==event.pointerId)return;
      touchActions.delete(code);
      button.classList.remove("active");
    });
  }
}
window.addEventListener("blur",clearTouchActions);
document.addEventListener("visibilitychange",()=>{if(document.hidden){keys.clear();clearTouchActions();}});
const touchHelm=$("touch-helm");

let helmPointer=null;
let helmOriginX=0,helmOriginY=0;

function touchSteering(axis){
  const travel=Math.max(0,Math.abs(axis)-.055)/.945;
  return Math.sign(axis)*(.24*travel+.76*travel**1.8);
}
function dragHelm(event){
  if(event.pointerId!==helmPointer)return;
  const knobRadius=touchHelm.firstElementChild.offsetWidth/2;
  const reachX=Math.max(1,touchHelm.clientWidth/2-knobRadius-5);
  const reachY=Math.max(1,touchHelm.clientHeight/2-knobRadius-5);
  const axis=clamp((event.clientX-helmOriginX)/reachX,-1,1);
  steering.set(touchHelm,-touchSteering(axis));
  const vertical=clamp((event.clientY-helmOriginY)/reachY,-1,1);
  touchHelm.style.setProperty("--stick-x",axis*reachX+"px");
  touchHelm.style.setProperty("--stick-y",vertical*reachY*Math.sqrt(1-axis**2)+"px");
}
function releaseHelm(event){
  if(event && event.pointerId!==helmPointer)return;
  helmPointer=null;
  steering.delete(touchHelm);
  touchHelm.style.removeProperty("--stick-x");
  touchHelm.style.removeProperty("--stick-y");
}
touchHelm.addEventListener("pointerdown",event=>{
  if(helmPointer!==null||event.button!==0)return;
  helmPointer=event.pointerId;
  helmOriginX=event.clientX;
  helmOriginY=event.clientY;
  touchHelm.setPointerCapture(helmPointer);
});
touchHelm.addEventListener("pointermove",dragHelm);
for(const type of ["pointerup","pointercancel","lostpointercapture"])
  touchHelm.addEventListener(type,releaseHelm);
window.addEventListener("blur",()=>releaseHelm());
document.addEventListener("visibilitychange",()=>{if(document.hidden)releaseHelm();});
function trim(id,tight,loose,dt){
  const input=$(id);
  const shift=Number(keys.has(loose))-Number(keys.has(tight));
  if(shift){
    const amount=clamp(Number(input.dataset.trim??input.value)+shift*36*dt,0,100);
    input.value=Math.round(amount);input.dataset.trim=amount;
  }else delete input.dataset.trim;
}
const prestartSeconds=3*60+5*60;
let startAt=0,audioCtx=null;
let ambience=null;
function seaAudio(ctx){
  const buf=ctx.createBuffer(1,ctx.sampleRate*4,ctx.sampleRate),samples=buf.getChannelData(0);
  for(let i=0;i<samples.length;i++)samples[i]=Math.random()*2-1;
  function layer(type,frequency,q,offset){
    const src=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();
    src.buffer=buf;src.loop=true;filter.type=type;filter.frequency.value=frequency;filter.Q.value=q;
    gain.gain.value=0;src.connect(filter);filter.connect(gain);gain.connect(ctx.destination);src.start(0,offset);
    return gain.gain;
  }
  const wind=layer("bandpass",635,.65,0),wash=layer("lowpass",1700,.4,1),hull=layer("bandpass",118,1.5,2);
  // One short pawl strike per tooth passing the sheave on the hauling stroke.
  const tooth=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*.021),ctx.sampleRate);
  const pulse=tooth.getChannelData(0);
  for(let i=0;i<pulse.length;i++){
    const t=i/ctx.sampleRate;
    pulse[i]=.26*Math.exp(-235*t)*(Math.sin(2*Math.PI*2460*t)+.55*Math.sin(2*Math.PI*3980*t)+.4*(Math.random()*2-1));
  }
  const rope=layer("bandpass",1350,.8,2.7),drum=layer("bandpass",340,3.5,.45);
  let previousBoat,lastMain=0,lastJib=0,lastSpi=0,lastSide=0,residual=0,previousLoads=[];
  const pawl=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*.095),ctx.sampleRate);
  const metal=pawl.getChannelData(0);
  for(let i=0;i<metal.length;i++){
    const t=i/ctx.sampleRate, phase=2*Math.PI*t;
    metal[i]=.27*Math.exp(-42*t)*Math.sin(phase*238)+.14*Math.exp(-61*t)*Math.sin(phase*563)
      +.09*Math.exp(-87*t)*Math.sin(phase*941);
  }
  let nextHaul=0,nextRelease=0,nextPawl=0;
  let previousRunners=null,haulTravel=0,releaseTravel=0,lastOn=false;
  function strike(buffer,at,rate,level){
    const src=ctx.createBufferSource(),gain=ctx.createGain();
    src.buffer=buffer;src.playbackRate.value=rate;gain.gain.value=level;
    src.connect(gain);gain.connect(ctx.destination);src.start(at);
  }
  const crack=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*.15),ctx.sampleRate);
  const wave=crack.getChannelData(0);
  for(let i=0;i<wave.length;i++){
    const t=i/ctx.sampleRate;
    wave[i]=.50*Math.exp(-32*t)*Math.sin(2*Math.PI*108*t)+.31*Math.exp(-49*t)*Math.sin(2*Math.PI*239*t)
      +.14*Math.exp(-70*t)*Math.sin(2*Math.PI*514*t)+.07*Math.exp(-180*t)*(Math.random()*2-1);
  }
  return (b,on)=>{
    const t=ctx.currentTime, pace=clamp(b.waterSpeed/5,0,1.6);
    const main=b.mainDuringStroke??b.main,jib=b.jib;
    const ocean=classes[boatClass].ocean, spi=b.spiSheet??50,side=b.spiTravel??0;
    const windSpeed=apparent(b,time).speed;
    const pressure=smoothStep(1,10,windSpeed);
    const loads=[b.mainSail,b.jibSail].map(s=>pressure*clamp(Math.hypot(s.sideLoad||0,s.thrust||0),0,1));
    loads.push(clamp(b.spiLoad||0,0,1));
    let slip=0;
    if(on && lastOn && b===previousBoat && ctx.state==="running"){
      const travel=Math.max(0,lastMain-main)+(classes[boatClass].jibShare?Math.max(0,lastJib-jib):0);
      const moves=[lastMain-main,classes[boatClass].jibShare?lastJib-jib:0,b.spiUp?lastSpi-spi:0];

      const transfer=b.spiUp?Math.abs(side-lastSide)*9:0;
      if(ocean){
        slip=transfer*Math.max(loads[2],previousLoads[2]||0);
        for(let i=0;i<moves.length;i++)
          slip+=Math.max(0,-moves[i])*Math.max(loads[i],previousLoads[i]||0);
        let unloading=0;
        if(previousRunners && b.runnerLoads){
          for(let i=0;i<2;i++){
            const change=b.runnerLoads[i]-previousRunners[i];
            haulTravel+=Math.max(0,change)*b.runnerLoads[i];
            unloading+=Math.max(0,-change)*previousRunners[i];
          }
          if(haulTravel>.06 && t>=nextHaul){
            nextHaul=t+.72+.25*Math.random();
            strike(crack,t,.91+.12*Math.random(),.33+.38*Math.max(...b.runnerLoads));haulTravel=0;
          }
        }
        const shedding=unloading*14+Math.min(slip,8)*.12;
        if(shedding>.012){
          releaseTravel+=shedding;
          const pops=Number(releaseTravel>=.21 && t>=nextRelease);
          if(pops)nextRelease=t+.24+.11*Math.random();
          releaseTravel%=.21;
          for(let i=0;i<pops;i++)
            strike(crack,t+i*.08/pops,(.72+.30*Math.random()),(.26+.53*Math.min(1,shedding))*(1-.10*i));
          slip+=unloading*23;
        }else releaseTravel=0;
      }
      residual+=travel+(ocean?Math.max(0,moves[2])+transfer:0);
      const ticks=Math.floor(residual/1.6);
      residual%=1.6;
      const count=ocean?Number(ticks>0 && t>=nextPawl):Math.min(8,ticks);
      if(ocean && count)nextPawl=t+.16;
      for(let i=0;i<count;i++){
        const src=ctx.createBufferSource();src.buffer=ocean?pawl:tooth;src.playbackRate.value=.93+.12*Math.random();
        src.connect(ctx.destination);src.start(t+i*.085/count);
      }
    }else {residual=0;haulTravel=0;releaseTravel=0;}
    lastOn=on;previousRunners=b.runnerLoads?.slice();
    rope.setTargetAtTime(.24*smoothStep(0,4,slip),t,.045);
    drum.setTargetAtTime(.43*smoothStep(.2,5,slip)*(.8+.2*Math.sin(t*54)),t,.065);
    previousLoads=loads;lastSpi=spi;lastSide=side;
    previousBoat=b;lastMain=main;lastJib=jib;
    const breeze=clamp(apparent(b,time).speed/14,0,1.5);
    const slap=clamp(Math.abs(b.heaveRate)+Math.abs(b.pitchRate)*2,0,1.6);
    wind.setTargetAtTime(on?.16*breeze:0,t,.28);
    wash.setTargetAtTime(on?(.015+.11*pace)*(1+.25*Math.sin(oceanTime*2)):0,t,.14);
    hull.setTargetAtTime(on?.30*slap*(.2+pace):0,t,.08);
  };
}
function horn(long=false,delay=0){
  if(!soundOn||!audioCtx||audioCtx.state!=="running")return;
  const t=audioCtx.currentTime+delay,d=long?1.15:.42;
  const osc=audioCtx.createOscillator(),gain=audioCtx.createGain();
  osc.type="triangle";osc.frequency.value=385;gain.gain.setValueAtTime(.001,t);
  gain.gain.exponentialRampToValueAtTime(.17,t+.025);gain.gain.exponentialRampToValueAtTime(.001,t+d);
  osc.connect(gain);gain.connect(audioCtx.destination);osc.start(t);osc.stop(t+d);
}
function hullFront(boat,line=course.startLine){
  const forward=vector(boat.h),beam=vector(boat.h+Math.PI/2);
  const {length,beam:width}=classes[boatClass], sn=boatClass==="snipe";
  let best=null,maximum=-Infinity;
  for(const [z,b] of [[.5,0],[.36,.58],[.19,.89],[0,1],[-.25,.97],[-.5,sn?.74:.61]]){
    for(const sign of [-1,1]){
      const p={x:boat.x+z*length*forward.x+sign*b*width*.5*beam.x,
        y:boat.y+z*length*forward.y+sign*b*width*.5*beam.y};
      const d=dot(delta(p,line.a),line.normal);
      if(d>maximum){maximum=d;best=p;}
    }
  }
  return {point:best,distance:maximum};
}
function updateStartClock(now){
  if(state!=="countdown")return;
  const before=pending;pending=Math.max(0,(startAt-now)/1000);
  if(!pending){
    state="running";time=0;horn();
    for(const b of boats){b.ocs=hullFront(b).distance>0;b.mustReturn=b.ocs;b.tackAt=0;b.trackAt=0;}
    if(boats.some(b=>b.ocs))horn(false,.65);
  }else if(before>60&&pending<=60)horn(true);
  else if((before>240&&pending<=240)||(before>300&&pending<=300))horn();
}
function tick(dt){
  if(state!=="countdown"&&state!=="running")return;
  if(state==="countdown")time=prestartSeconds-pending;
  checkRaceRules(dt);
  for(const boat of boats){
    if(boat.remote)continue;
    const requested=boat.i?boat.waterSpeed>.75:keys.has("KeyP");
    boat.penaltyTurning=Boolean(boat.penalties.length && !boat.downSide && boat.clearToTurn &&
      !boat.mustReturn && (boat.penaltyTurning && boat.i || requested));
    if(!boat.penaltyTurning)boat.penaltyProgress=null;
    const heading=boat.h;
    simulate(boat,dt);
    servePenalty(boat,heading);
  }
  if(boats[0].finish!==null)state="finished";
}
const dial=$("windDial").getContext("2d");
const compass=$("compass").getContext("2d");
function drawInstruments(heading,apparentAngle,trueAngle){
  dial.setTransform(2,0,0,2,0,0);
  dial.clearRect(0,0,160,160);
  dial.save();dial.translate(80,80);
  const polar=(a,r)=>[Math.sin(a)*r,-Math.cos(a)*r];
  dial.beginPath();dial.arc(0,0,75,0,Math.PI*2);dial.fillStyle="#132d31";dial.fill();
  function arc(start,end,color){
    dial.strokeStyle=color;dial.lineWidth=3;dial.beginPath();
    dial.arc(0,0,72,(start-90)*rad,(end-90)*rad);dial.stroke();
  }
  arc(-174,-6,"#ba605f");arc(6,174,"#58988b");
  dial.textAlign="center";dial.textBaseline="middle";
  for(let degree=-175;degree<=180;degree+=5){
    const major=degree%30===0;
    const a=degree*rad;
    dial.strokeStyle=major?"#d0ded5":"#668783";dial.lineWidth=major?1.5:.8;
    dial.beginPath();dial.moveTo(...polar(a,major?62:66));dial.lineTo(...polar(a,69));dial.stroke();
    if(major){
      dial.fillStyle="#e4ece5";dial.font="10px monospace";
      dial.fillText(String(Math.abs(degree)),...polar(a,52));
    }
  }
  dial.fillStyle="#9cb5ae";dial.font="9px monospace";
  dial.fillText(tr("BB"),-31,0);dial.fillText(tr("BE"),31,0);
  dial.fillText(tr("PROA"),0,-33);
  function pointer(a,color,radius,ghost){
    dial.save();dial.rotate(a);
    dial.strokeStyle=color;dial.fillStyle=color;dial.lineWidth=ghost?2:2.5;
    dial.setLineDash(ghost?[4,3]:[]);
    dial.beginPath();dial.moveTo(0,ghost?5:-40);dial.lineTo(0,-radius+9);dial.stroke();dial.setLineDash([]);
    dial.beginPath();dial.moveTo(0,-radius);dial.lineTo(-4,-radius+10);dial.lineTo(4,-radius+10);dial.closePath();
    if(ghost)dial.stroke();else dial.fill();
    dial.restore();
  }
  pointer(trueAngle,"#7edaf4",44,true);
  pointer(apparentAngle,"#ddf881",61,false);
  dial.beginPath();dial.arc(0,0,4,0,Math.PI*2);dial.fillStyle="#c2d4cc";dial.fill();dial.restore();

  compass.setTransform(2,0,0,2,0,0);
  compass.clearRect(0,0,188,25);
  const bearing=heading/rad;
  compass.textAlign="center";compass.font="10px monospace";
  for(let i=Math.floor(bearing/10)*10-40;i<=bearing+50;i+=10){
    const x=94+(i-bearing)*2, degree=(i+360)%360;
    compass.strokeStyle="#9eb7af";
    compass.beginPath();compass.moveTo(x,1);compass.lineTo(x,degree%30===0?9:5);compass.stroke();
    if(degree%30===0){
      compass.fillStyle="#b4c9c1";
      compass.fillText({0:"N",90:sailLocale.language==="pt-BR"?"L":"E",180:"S",270:sailLocale.language==="en"?"W":"O"}[degree]??String(degree),x,22);
    }
  }
  compass.fillStyle="#ddf881";compass.beginPath();
  compass.moveTo(94,12);compass.lineTo(89,.5);compass.lineTo(99,.5);compass.fill();
}
function committeeSignals(){
  const classFlag=classes[boatClass].flag;
  const flags=[];
  if(state==="countdown"&&pending<=300)flags.push([classFlag,classes[boatClass].name]);
  if(state==="countdown"&&pending<=240&&pending>60)flags.push(["P",tr("Preparação")]);
  if(state==="running"&&time<240&&boats.some(v=>v.mustReturn))flags.push(["X",tr("Chamada individual")]);
  return flags;
}
function hud(){
  const b=boats[0], readings=windReadings(b,time);
  const awa=wrap(readings.apparent.from-b.h), twa=wrap(readings.real.from-b.h);
  drawInstruments(b.h,awa,twa);
  const relativeText=a=>Math.abs(a)<.5*rad?"0°":fmt(Math.abs(a/rad),0)+"° "+(a<0?tr("BB"):tr("BE"));
  if(classes[boatClass].ocean||classes[boatClass].classic){
    const action=b.spiUp?tr("Arriar balão"):tr("Içar balão");
    $("spi-toggle").title=action;
    $("spi-toggle").setAttribute("aria-label","Spi · "+action);
    $("spiTrim").disabled=autoTrim||!b.spiUp;
    if(autoTrim)$("spiTrim").value=Math.round(b.spiSheet??50);
    const spiState=!b.spiUp?(b.spiHoist>.01?tr("Arriando"):tr("Arriado")):b.spiHoist<.001 && b.halyardCrew<1?tr("Preparando"):b.spiHoist<.99?tr("Içando"):holding("KeyF")?tr("Folgado"):b.spiFill<.25?tr("Panejando"):b.spiFill<.72?tr("Enchendo"):tr("Cheio");
    $("spiValue").value=(b.spiUp?Math.round(b.spiSheet??50)+"% · ":"")+spiState;
    $("spi-toggle").setAttribute("aria-pressed",String(!!b.spiUp));
    const selector=$(boatClass==="clubswan36"?"swan-jib":"soto-jib");
    selector.options[0].textContent="Auto · J"+(b.jibNumber||1);
    selector.value=String(b.jibManual||0);
  }
  const target=course.targets[b.stage];
  const point=target?guidePoint(b,target):null;
  const relative=point?wrap(angle(delta(point,b))-b.h)/rad:0;
  $("dtw").textContent=point?Math.round(distance(point,b))+" m":"—";
  $("dtw-cue").textContent=point?(Math.abs(relative)<12?"↑":relative<0?"←":"→"):"";
  const stamp=state==="countdown"?Math.ceil(pending>300?pending-300:pending):Math.floor(time);
  $("clock").textContent=String(Math.floor(stamp/60)).padStart(2,"0")+":"+String(stamp%60).padStart(2,"0");
  $("bs").textContent=fmt(b.waterSpeed/knot);
  $("speed").textContent=fmt(b.speed/knot);
  $("heading").textContent=bearing(b.h);
  $("tws").textContent=fmt(readings.real.speed/knot);
  $("twd").textContent=bearing(readings.real.from);
  const windAngle=a=>(Math.abs(a)<.5*rad?"":a<0?"−":"+")+Math.round(Math.abs(a/rad))+"°";
  $("twa").textContent=windAngle(twa);
  $("awa").textContent=windAngle(awa);
  $("twa").title=relativeText(twa);$("awa").title=relativeText(awa);
  $("apparent").textContent=relativeText(awa);
  $("true-angle").textContent=relativeText(twa);
  $("app-speed").textContent=fmt(readings.apparent.speed/knot)+" Kts";
  $("true-speed").textContent=fmt(readings.real.speed/knot)+" Kts";
  const easing=holding("KeyF");
  if(autoTrim&&!easing){$("mainTrim").value=Math.round(b.main);$("jibTrim").value=Math.round(b.jib);}
  $("mainValue").value=easing?("100% · "+tr("Folgada")):b.pumpPull>0?Math.round(b.mainDuringStroke)+"% · "+(holding("KeyB")?(b.pumpPull===1?tr("Caçada"):tr("Caçando")):tr("Folgando")):$("mainTrim").value+"% · "+tr(b.mainSail.trimState);
  if(starRigDialog.open)updateStarRigPanel(b);
  if(classes[boatClass].jibShare){
    const jib=$("jibTrim").value;
    const exposed=classes[boatClass].classic?brasilGenoaHoist(b):1;
    $("jibTrim").disabled=autoTrim||exposed===0;
    $("jibValue").value=exposed===0?tr("No convés"):exposed<1?tr(b.spiUp?"Arriando":"Içando"):easing?("100% · "+tr("Folgada")):jib+"% · "+tr(b.jibSail.trimState);
  }
  $("goal").textContent=state==="finished"?tr("REGATA CONCLUÍDA"):state==="running"?tr(target.name).toUpperCase():state==="countdown"?tr("PREPARE-SE A SOTAVENTO DA LINHA"):"";
  $("goal").hidden=state==="idle"&&!b.downSide;
  $("right-boat").hidden=!b.downSide || b.righting;
  if(b.downSide)$("goal").textContent=b.righting?tr("DESVIRANDO"): tr("CAPOTADO · V PARA DESVIRAR");
  const rank=boats.filter(other=>other.i&&other.finish!==null&&other.finish<=time).length+1;
  $("race-stage").textContent=state==="idle"?tr("Aguardando largada"):state==="countdown"?(pending>300?tr("Até o procedimento"):tr("Até o tiro de largada")):state==="finished"?tr("{rank}º lugar de {total}").replace("{rank}",rank).replace("{total}",boats.length):target?.leg?tr("Leg")+" "+target.leg+" / "+course.legCount:tr("Pré-largada");
  const flags=committeeSignals();
  const flagHtml=flags.map(([code,name])=>'<span class="sig"><i class="'+code+'"></i>'+name+'</span>').join("");
  if($("flags").innerHTML!==flagHtml)$("flags").innerHTML=flagHtml;
  $("ocs").textContent=b.ocs?(b.mustReturn?tr("OCS · Volte com todo o casco"):tr("OCS · Cruze a linha novamente")):"";
  const penalty=b.penalties[0];
  const panel=$("penalty");
  panel.hidden=!penalty;
  if(penalty){
    $("penalty-rule").textContent=penalty.rule;
    $("penalty-action").textContent="⟳ "+penalty.turns*360+"°";
    $("penalty-detail").textContent=tr(ruleNames[penalty.rule])+" · "+(onlineRace?penalty.detail:tr(penalty.detail))+
      (b.penalties.length>1?" · +"+(b.penalties.length-1):"");
    $("penalty-help").textContent=b.mustReturn?tr("Corrija a largada primeiro"):!b.clearToTurn?tr("Afaste-se dos outros barcos"):
      b.penaltyTurning?tr("Giro em andamento ·")+" "+Math.floor((b.penaltyProgress?.sweep||0)/rad+360*(b.penaltyProgress?.turns||0))+"°":tr("Segure P e use o leme");
  }
  const news=raceNotices.find(notice=>notice.until>oceanTime&&(notice.boat.i || notice.action==="Cumprida"));
  $("race-notice").textContent=news?"⚑ "+news.rule+" · "+(onlineRace?news.boat.name:tr(news.boat.name))+" · "+tr(news.action):"";
  document.querySelectorAll("[data-turn]").forEach(button=>{
    const value=+button.dataset.turn;
    button.classList.toggle("active",keys.has(value<0?"ArrowRight":"ArrowLeft")||[...steering.values()].includes(value));
  });
}
const miniMap=$("tactical-hud"), mini=miniMap.getContext("2d");
function drawMiniMap(){
  if(!mini||state==="idle")return;
  mini.setTransform(2,0,0,2,0,0);
  mini.clearRect(0,0,156,130);
  const up=course.startLine.normal,right={x:-up.y,y:up.x};
  const dots=course.marks.concat(boats);
  const spread=Math.max(190,...dots.map(p=>Math.max(Math.abs(dot(delta(p,course.venue),up)),Math.abs(dot(delta(p,course.venue),right))*1.08)));
  const scale=52/spread;
  const screen=p=>{
    const diff=delta(p,course.venue);
    return [78+dot(diff,right)*scale,65-dot(diff,up)*scale];
  };
  mini.lineWidth=1;
  for(const line of [course.startLine,course.finishLine]){
    mini.beginPath();mini.moveTo(...screen(line.a));mini.lineTo(...screen(line.b));
    mini.strokeStyle="#a6c6ce88";mini.stroke();
  }
  mini.font="9px system-ui";
  const player=boats[0], active=player.zoneMark;
  for(const mark of course.marks){
    const [x,y]=screen(mark);
    mini.beginPath();mini.arc(x,y,zoneRadius()*scale,0,Math.PI*2);
    mini.strokeStyle=mark===active?"#a8f5ff":"#9cddea72";mini.stroke();
    mini.fillStyle="#ffd187";mini.fillRect(x-1.5,y-1.5,3,3);
    const left=mark===course.marks[1]||mark===course.marks[2];
    mini.textAlign=left?"right":"left";
    mini.fillText(mark.label,x+(left?-5:5),y-3);
  }
  for(const boat of boats){
    const [x,y]=screen(boat),dir=vector(boat.h),rotation=Math.atan2(dot(dir,right),dot(dir,up));
    mini.save();mini.translate(x,y);mini.rotate(rotation);
    mini.fillStyle=boat.i?boat.color:"#fff";
    mini.beginPath();mini.moveTo(0,boat.i?-4:-6);mini.lineTo(boat.i?-2.6:-3.7,3);
    mini.lineTo(boat.i?2.6:3.7,3);mini.closePath();mini.fill();mini.restore();
  }
  const status=$("hud-zone");
  const message=player.markRoomDuty?tr("Dê espaço")+" · R18":player.markRoomRight?tr("Espaço na marca")+" · R18":active?tr("Zona")+" "+active.label:"";
  if(status.textContent!==message)status.textContent=message;
  status.hidden=!message;
}
let hudAt=0;
function frame(stamp){
  const dt=clamp((stamp-last)/1000,0,.05);last=stamp;
  oceanTime=onlineRace?Math.max(0,(stamp-onlineRace.start)/1000+prestartSeconds):oceanTime+dt;
  if(onlineRace){
    for(const boat of boats)if(boat.remote)moveRemote(boat,dt,stamp);
    while(windShift&&oceanTime>=windShift.end)windShift=nextWindShift(windShift.to,windShift.end,onlineRace.random);
  }else if(windShift&&oceanTime>=windShift.end)windShift=nextWindShift(windShift.to,oceanTime);
  if(!autoTrim)trim("mainTrim","ArrowUp","ArrowDown",dt);
  if(!autoTrim&&!$("jibTrim").disabled&&classes[boatClass].jibShare)trim("jibTrim","KeyQ","KeyE",dt);
  updateStartClock(stamp);
  if(state==="running")time=Math.max(0,(stamp-startAt)/1000);
  accumulator+=dt;
  while(accumulator>=1/40){tick(1/40);accumulator-=1/40;}
  if(state==="idle"){
    boats[0].main=+$("mainTrim").value;
    boats[0].jib=+$("jibTrim").value;
    for(const boat of boats){
      const readings=windReadings(boat,time), wind=readings.apparent;
      updateRig(boat,readings,dt);
      const water=waterSample(course.water,boat.x,boat.y,oceanTime);
      boat.heave=water.height;
      boat.pitch=water.slopeX*Math.sin(boat.h)-water.slopeZ*Math.cos(boat.h);
      const beamSlope=water.slopeX*Math.cos(boat.h)+water.slopeZ*Math.sin(boat.h);
      const degrees=Math.abs(wrap(wind.from-boat.h)/rad);
      const forces=sailForces(boat,wind,degrees);
      springMotion(boat,"heel","rollRate",rollTarget(boat,forces.side,beamSlope),9/classes[boatClass].inertia,3.8,dt);
    }
  }
  if(stamp>=hudAt){if(ambience)ambience(boats[0],soundOn&&state!=="idle"&&!document.hidden);hud();drawMiniMap();hudAt=stamp+100;}
  if(state==="idle"){requestAnimationFrame(frame);return;}
  if(tactical){
    for(const boat of boats)if(boat.tag)boat.tag.hidden=true;
    draw();
  }
  else scene.draw({boats,course,conditions:{...conditions,dir:windDirection()},signals:committeeSignals(),apparentWind:apparent(boats[0],time),zoneRadius:zoneRadius(),boatClass,time,oceanTime,dt,coast:course.venue.scenery==="santos"?coast:alternateCoast[course.venue.scenery],sideView,cockpitView,orbitYaw,orbitActive});
  requestAnimationFrame(frame);
}
setup();showWeather();hud();requestAnimationFrame(frame);
updateWeather();setInterval(updateWeather,300000);

document.addEventListener("sail-language-change", () => {
  const venue = chosenVenue();
  $("venue-title").textContent = venue.scenery === "santos" ? tr("Baía de Santos") : venue.region;
  $("wind-shift-status").textContent = tr(windShiftsEnabled ? "Ligado" : "Desligado");
  $("boat-view").textContent = tr(sideView ? ((classes[boatClass].ocean||classes[boatClass].classic) ? "Ver cockpit" : "Vista de popa") : cockpitView ? "Vista de popa" : "Vista lateral");
  showWeather();
  multiplayer.refreshLanguage();
  hud();
});
