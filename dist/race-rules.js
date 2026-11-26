"use strict";

const ruleNames={
  10:"Bombordo mantém-se afastado",11:"Barco de barlavento mantém-se afastado",
  12:"Barco safo pela popa mantém-se afastado",13:"Mantenha-se afastado durante o bordo",
  14:"Evite contato",15:"Dê espaço ao adquirir preferência",16:"Dê espaço ao mudar de rumo",
  17:"Não orce acima do rumo correto",18:"Dê espaço na marca",21:"Mantenha-se afastado ao retornar ou pagar giros",
  22:"Evite o barco capotado",31:"Toque na marca"
};
let raceIncidents, raceNotices;
function resetRules(){
  raceIncidents=new Map();
  raceNotices=[];
}
function addPenalty(boat,rule,detail){
  if(boat.remote)return;
  const turns=rule===31?1:2;
  boat.penalties.push({rule,detail,turns});
  announcePenalty(boat,rule,turns*360+"°");
}
function announcePenalty(boat,rule,action){
  raceNotices.unshift({boat,rule,action,until:oceanTime+7});
  raceNotices.length=Math.min(raceNotices.length,16);
}

function ruleSnapshot(boat,dt){
  const wind=windReadings(boat,time).real.from;
  const relative=wrap(boat.h-wind);
  const tack=Math.sign(relative)||boat.ruleTack||1;
  const pastWind=boat.ruleTack&&tack!==boat.ruleTack&&Math.abs(relative)<Math.PI/2;
  if(pastWind)boat.ruleTacking=true;
  if(Math.abs(relative)>=classes[boatClass].noGo*rad)boat.ruleTacking=false;
  const portToStarboard=Boolean(pastWind&&tack<0);
  boat.ruleTack=tack;
  return {boat,wind,relative,tack,portToStarboard,h:boat.h,forward:vector(boat.h),x:boat.x,y:boat.y,
    vx:boat.vx,vy:boat.vy,turn:wrap(boat.h-(boat.previousRuleHeading??boat.h))/dt};
}

function classLength(){
  return classes[boatClass].length;
}
function zoneRadius(){
  return 3*classLength();
}
function hullInZone(boat,mark){
  // Project the mark onto the hull centreline and allow the narrow section at each end.
  const length=classLength(), diff=delta(mark,boat);
  const along=clamp(dot(diff,boat.forward),-length*.5,length*.5);
  const beam=classes[boatClass].beam;
  const halfWidth=beam*.5*(1-.65*(2*Math.abs(along)/length)**2);
  return Math.hypot(diff.x-along*boat.forward.x,diff.y-along*boat.forward.y)<=zoneRadius()+halfWidth;
}
function clearAstern(a,b){
  const aftProjection=dot(delta(a,b),b.forward);
  const alignment=Math.abs(dot(a.forward,b.forward));
  return aftProjection<-.5*classLength()*(1+alignment);
}
function roundingCandidates(s){
  const target=course.targets[s.boat.stage];
  if(target?.exits)return gateExit(s.boat,target)?.rounding??[];
  return target?.rounding??[];
}
function aroundMark(a,b,incident){
  const shared=a.rounding.filter(mark=>b.rounding.includes(mark));
  const mark=shared.find(mark=>a.zone.has(mark)||b.zone.has(mark));
  const beating=Math.min(Math.abs(a.relative),Math.abs(b.relative))<60*rad;
  if(!mark||a.boat.mustReturn||b.boat.mustReturn||a.boat.penaltyTurning||b.boat.penaltyTurning||
      (a.tack!==b.tack&&(beating||a.boat.ruleTacking||b.boat.ruleTacking))){
    incident.room=null;
    return null;
  }
  // A boat moving away after rounding and one still approaching are different encounters.
  const leaving=s=>dot(delta(s,mark),s.forward)>classLength()*.5;
  if(leaving(a)!==leaving(b)){incident.room=null;return null;}
  const previous=incident.room;
  // 18.3 at the port-rounding marks. At the gate this special case is irrelevant.
  if(mark.label==="1"||mark.label==="1A"){
    const tacker=a.boat.tackedInZone?.has(mark)?a:b.boat.tackedInZone?.has(mark)?b:null;
    const other=tacker===a?b:a;
    if(tacker&&tacker.tack<0&&other.tack<0&&other.boat.zoneEntryTack?.get(mark)<0&&
        wrap(angle(delta(mark,other))-other.wind)<-(classes[boatClass].noGo-1)*rad&&
        dot(delta(mark,other),other.forward)>-.2){
      const otherInside=!clearAstern(other,tacker)&&!clearAstern(tacker,other)&&
        distance(other,mark)<distance(tacker,mark);
      return incident.room={mark,owner:otherInside?other.boat:null,locked:false,tackingRule:true};
    }
  }
  const eligible=a.tack===b.tack||(Math.abs(a.relative)>90*rad&&Math.abs(b.relative)>90*rad);
  const overlapped=eligible&&!clearAstern(a,b)&&!clearAstern(b,a);
  const inside=distance(a,mark)<=distance(b,mark)?a:b;
  if(previous?.mark===mark){
    const owner=previous.owner===a.boat?a:b;
    if(previous.locked&&owner.zone.has(mark)&&!owner.boat.ruleTacking&&owner.tack===previous.tack)return previous;
    if(!overlapped)return previous.locked?(incident.room={mark,owner:null,locked:false}):null;
    return incident.room={mark,owner:inside.boat,locked:false};
  }
  const entryA=a.zone.get(mark)??Infinity, entryB=b.zone.get(mark)??Infinity;
  const first=entryA===entryB?inside:entryA<entryB?a:b;
  const owner=overlapped?inside:first;
  return incident.room={mark,owner:owner.boat,tack:owner.tack,locked:true};
}

function rightOfWay(a,b){
  if(a.boat.penaltyTurning!==b.boat.penaltyTurning)return [a.boat.penaltyTurning?a:b,21];
  if(a.boat.mustReturn!==b.boat.mustReturn)return [a.boat.mustReturn?a:b,21];
  if(Boolean(a.boat.downSide)!==Boolean(b.boat.downSide))return [a.boat.downSide?b:a,22];
  if(a.boat.ruleTacking!==b.boat.ruleTacking)return [a.boat.ruleTacking?a:b,13];
  if(a.boat.ruleTacking&&b.boat.ruleTacking){
    const lateral=dot(delta(a,b),vector(b.h+Math.PI/2));
    return [Math.abs(lateral)>.75?(lateral<0?a:b):(dot(delta(a,b),b.forward)<0?a:b),13];
  }
  if(a.tack!==b.tack)return [a.tack>0?a:b,10];

  if(clearAstern(a,b)&&!clearAstern(b,a))return [a,12];
  if(clearAstern(b,a)&&!clearAstern(a,b))return [b,12];
  const weather=dot(delta(a,b),vector(a.wind));
  return Math.abs(weather)>.06?[weather>0?a:b,11]:null;
}

// A chain of circles approximates the narrow hull without treating the bow as full beam.
function hullSeparation(a,b,length){
  let closest=Infinity;
  const scale=classes[boatClass].beam/1.52;
  const stations=[[-.34,.58*scale],[-.12,.72*scale],[.12,.68*scale],[.36,.42*scale]];
  for(const [alongA,widthA] of stations)for(const [alongB,widthB] of stations){
    const dx=a.x+a.forward.x*alongA*length-b.x-b.forward.x*alongB*length;
    const dy=a.y+a.forward.y*alongA*length-b.y-b.forward.y*alongB*length;
    closest=Math.min(closest,Math.hypot(dx,dy)-widthA-widthB);
  }
  return closest;
}

function checkRaceRules(dt){
  // Free practice uses the same avoidance logic. Formal race scoring starts at the warning signal.
  const racing=state==="running"||pending<=300;
  const length=classLength();
  const fleet=boats.filter(boat=>!boat.offline&&boat.finish===null).map(boat=>ruleSnapshot(boat,dt));
  for(const s of fleet){
    s.boat.previousRuleHeading=s.h;
    s.boat.avoidance=null;
    s.boat.clearToTurn=true;
    s.boat.turnWind=s.wind;
    s.boat.markRoomDuty=false;
    s.boat.markRoomRight=false;
    s.rounding=roundingCandidates(s);
    const lastZone=s.boat.ruleZone;
    const zoneEntryTack=new Map(), tackedInZone=new Set();
    s.zone=new Map();
    for(const mark of s.rounding){
      if(!hullInZone(s,mark))continue;
      s.zone.set(mark,lastZone?.get(mark)??oceanTime);
      const entry=s.boat.zoneEntryTack?.get(mark)??s.tack;
      zoneEntryTack.set(mark,entry===s.tack?entry:0);
      if(s.portToStarboard||s.boat.tackedInZone?.has(mark))tackedInZone.add(mark);
    }
    s.boat.zoneEntryTack=zoneEntryTack;
    s.boat.tackedInZone=tackedInZone;
    s.boat.ruleZone=s.zone;
    s.boat.zoneMark=s.zone.keys().next().value;

  }
  const marks=[...course.marks,course.startLine.pin,course.startLine.committee,course.finishLine.pin,course.finishLine.committee];
  for(const a of fleet){
    const b=a.boat;
    const touching=marks.find(mark=>distance(mark,a)<5&&
      hullSeparation(a,{...mark,forward:{x:0,y:0}},length)<((mark===course.startLine.committee||mark===course.finishLine.committee) ? .9 : .17));
    a.markTouch=touching||null;
    if(touching)b.clearToTurn=false;
  }
  for(let i=0;i<fleet.length;i++)for(let j=i+1;j<fleet.length;j++){
    const a=fleet[i],b=fleet[j],range=distance(a,b);
    const key=a.boat.i*boats.length+b.boat.i;
    const closingSpeed=Math.hypot(a.vx-b.vx,a.vy-b.vy);
    const horizon=classes[boatClass].ocean?10:7;
    const margin=.58*length+classes[boatClass].beam;
    if(range>Math.max(35,margin+closingSpeed*horizon,zoneRadius()*2)){raceIncidents.delete(key);continue;}
    if(range<Math.max(10,length*1.7)){a.boat.clearToTurn=false;b.boat.clearToTurn=false;}
    const incident=raceIncidents.get(key)||{};
    raceIncidents.set(key,incident);
    const room=aroundMark(a,b,incident);
    const roomOwner=room?.owner===a.boat?a:room?.owner===b.boat?b:null;
    const roomGiver=roomOwner===a?b:a;
    if(roomOwner){
      roomOwner.boat.markRoomRight=true;
      roomGiver.boat.markRoomDuty=true;
    }
    const rights=rightOfWay(a,b)??(roomOwner?[roomGiver,18]:null);
    if(!rights)continue;
    const [give,baseRule]=rights,keep=give===a?b:a;
    const offset=delta(give,keep),velocity={x:give.vx-keep.vx,y:give.vy-keep.vy};
    const cpa=clamp(-dot(offset,velocity)/Math.max(.0001,dot(velocity,velocity)),0,horizon);
    const miss=Math.hypot(offset.x+cpa*velocity.x,offset.y+cpa*velocity.y);
    if(baseRule===12)incident.clearAstern=give.boat;
    if(baseRule===11&&range<=2*length&&incident.clearAstern===keep.boat)incident.leewardLimit=keep.boat;
    if(baseRule!==11||range>2*length)incident.leewardLimit=null;
    const markObstructed=roomOwner&&distance(roomOwner,room.mark)<zoneRadius()&&
      distance(roomGiver,room.mark)<distance(roomOwner,room.mark)+length*.65;
    if(incident.give!==give.boat){
      if((baseRule===11||baseRule===12)&&miss<3.4&&range<6&&!incident.infringed)incident.newRightsUntil=oceanTime+1;
      incident.give=give.boat;
    }
    const detour=(yielding,other,urgency,openAway=false)=>{
      if(yielding.boat.avoidance?.urgency>=urgency)return;
      const route=other.forward;
      const lead=1.45*length;
      // Aim behind the future stern at the crossing. Parallel boats instead
      // open lateral clearance on their existing side.
      const parallel=dot(yielding.forward,route)>.80;
      const across=vector(other.h+Math.PI/2);
      const gap=dot(delta(yielding,other),across);
      const side=Math.sign(gap)||1;
      const advance=Math.min(0,cpa*Math.hypot(other.vx,other.vy)-lead);

      const escape=openAway?delta(yielding,other):parallel?{x:route.x+.85*side*across.x,y:route.y+.85*side*across.y}:
        {x:other.x+route.x*advance-yielding.x-route.x*length,y:other.y+route.y*advance-yielding.y-route.y*length};
      yielding.boat.avoidance={heading:angle(escape),urgency};
    };
    if(miss<margin && (dot(offset,velocity)<0 || range<margin)){
      if(markObstructed)detour(roomOwner===a?b:a,roomOwner,9);
      else detour(give,keep,12-cpa+(1-miss/margin));
      if(range<.65*length&&!markObstructed)detour(keep,give,5,true);
    }
    const separation=range<length+classes[boatClass].beam?hullSeparation(a,b,length):Infinity;
    if(separation>1.2&&range>10){incident.infringed=false;incident.dangerSince=null;}
    if(separation<.9)incident.dangerSince??=oceanTime;
    if(separation<0&&range>.01){
      const release=Math.min(.7,-separation+.2)/range;
      const push=delta(a,b);
      a.boat.vx+=push.x*release*dt*8;a.boat.vy+=push.y*release*dt*8;
      b.boat.vx-=push.x*release*dt*8;b.boat.vy-=push.y*release*dt*8;
    }
    const next=course.targets[keep.boat.stage];
    const nextPoint=guidePoint(keep.boat,next);
    let improper=false;
    if(state==="running"&&baseRule===11&&incident.leewardLimit===keep.boat&&nextPoint &&
        keep.boat.stage===give.boat.stage&&distance(nextPoint,keep)>20){
      const proper=Math.max(classes[boatClass].beat*rad,Math.abs(wrap(angle(delta(nextPoint,keep))-keep.wind)));
      improper=Math.abs(keep.relative)+12*rad<proper&&keep.relative*keep.turn<-.09;
    }
    if(!racing||incident.infringed||(separation>.18&&!improper)||(baseRule===18&&!markObstructed))continue;
    let offender=give,rule=baseRule;
    if(improper){offender=keep;rule=17;}
    else if(markObstructed){offender=roomOwner===a?b:a;rule=18;}
    else if(incident.newRightsUntil>oceanTime&&baseRule!==10&&baseRule!==13&&baseRule<21){offender=keep;rule=15;}
    else if(baseRule<21&&Math.abs(keep.turn)>.35&&dot(offset,vector(keep.h+Math.sign(keep.turn)*Math.PI/2))>.5){
      offender=keep;rule=16;
    }
    addPenalty(offender.boat,rule,(offender===a?b:a).boat.name);
    if(separation<0 && rule!==18 && offender===give && oceanTime-incident.dangerSince>2 && Math.abs(keep.turn)<.05)
      addPenalty(keep.boat,14,give.boat.name);
    incident.infringed=true;
    offender.markTouchServed=offender.markTouch;
  }
  for(const a of fleet){
    if(racing&&a.markTouch&&a.markTouch!==a.boat.lastMarkTouch&&a.markTouch!==a.markTouchServed)
      addPenalty(a.boat,31,a.markTouch.label||"Linha da regata");
    a.boat.lastMarkTouch=a.markTouch;
  }
}

function servePenalty(boat,previousHeading){
  const penalty=boat.penalties[0];
  if(!penalty||!boat.penaltyTurning||boat.downSide)return;
  const signed=wrap(boat.h-previousHeading);
  if(Math.abs(signed)<.00001)return;
  const turn=boat.penaltyProgress??{sweep:0,direction:Math.sign(signed),turns:0,up:false,down:false};
  boat.penaltyProgress=turn;
  const before=wrap(previousHeading-boat.turnWind);
  const after=wrap(boat.h-boat.turnWind);
  const advance=signed*turn.direction;
  if(advance<0){
    turn.sweep=Math.max(0,turn.sweep+advance);
    turn.reverse=(turn.reverse||0)-advance;
    if(turn.reverse>12*rad)boat.penaltyProgress=null;
    return;
  }
  turn.reverse=0;
  turn.sweep+=advance;
  if(Math.sign(before)!==Math.sign(after)){
    if(Math.abs(before)<Math.PI/2)turn.up=true;
    else turn.down=true;
  }
  if(turn.sweep<2*Math.PI-1e-8||!turn.up||!turn.down)return;
  turn.turns++;
  if(turn.turns<penalty.turns){
    turn.sweep=0;turn.up=false;turn.down=false;
    return;
  }
  boat.penaltyProgress=null;
  boat.penalties.shift();
  announcePenalty(boat,penalty.rule,"Cumprida");
}
