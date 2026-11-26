"use strict";

// Paint is cut once in hull coordinates. Heel and waves expose the black bottom
// without moving the painted stripe up and down the topsides.
const brasilPaintCache=new WeakMap();
const brasilBottom=[.044,.046,.047],brasilStripe=[.34,.062,.102];
function brasilPaintFaces(face,stripe=brasilStripe){
  const result=[];
  let upper=face;
  for(const [level,color] of [[.055,brasilBottom],[.145,stripe]]){
    const lower=[],next=[];
    let a=upper.at(-1);
    for(const b of upper){
      if((a[1]<level && b[1]>level)||(a[1]>level && b[1]<level)){
        const t=(level-a[1])/(b[1]-a[1]);
        const edge=[a[0]+t*(b[0]-a[0]),level,a[2]+t*(b[2]-a[2])];
        lower.push(edge);next.push(edge);
      }
      if(b[1]<=level)lower.push(b);
      if(b[1]>=level)next.push(b);
      a=b;
    }
    if(lower.length>=3)result.push([lower,color]);
    upper=next;
  }
  if(upper.length>=3)result.push([upper,[.92,.90,.82]]);
  return result;
}

// The paired halyard manoeuvre reverses at the current height on a cancelled set.
function brasilGenoaHoist(boat){
  return 1-spiRamp(.18,.91,boat.spiHoist||0);
}
function brasilGenoaPoint(flying,v,u,hoist){
  if(hoist===1)return flying;
  // Flake the sail lengthwise on the foredeck, abaft its fixed tack.
  const along=(1-v)*u;
  const z=5.98-1.23*v-2.87*along;
  const deckY=z<4.22?1.22+(z-4.22)*.075:
    z<5.35?1.22+(z-4.22)*.115:1.35+(z-5.35)*.147;
  const spread=(5.98-z)/2.87;
  const fold=Math.cos(v*8*Math.PI);
  const packed=[spread*(.80+.14*fold),deckY+.048+spread*(.04+.035*Math.sin(v*8*Math.PI)),z];
  return [...packed.map((n,i)=>n+(flying[i]-n)*hoist),u,v];
}

function drawClassicShell(design,panel,hull,rod,deck,wood,ivory,stripe){
  let prev;
  const paint=brasilPaintCache.get(design.sections)||[];
  const buildPaint=!brasilPaintCache.has(design.sections);
  const addPaint=(a,b,c,d)=>paint.push(...brasilPaintFaces([a,b,c,d],stripe));
  for(const [z,w,y,bottom,opening] of design.sections){
    const cockpit=Math.max(0,opening);
    const sides=[-1,1].map(side=>{
      const frames=[[1,y],[.985,y-.11],[.95,y*.68+bottom*.32],
        [design.bilge??.83,y*.36+bottom*.64],[.56,y*.15+bottom*.85],[.24,y*.05+bottom*.95],[0,bottom]];
      return frames.map(([radius,h])=>[side*w*radius,h,z]);
    });
    for(let k=0;k<2;k++){
      const s=k*2-1,row=sides[k],rim=[s*cockpit,y+.035,z];
      const floorY=design.wheel?Math.max(y-.54,bottom+.20):.48;
      // Keep the sole inside the actual section at its own elevation.
      let soleWidth=cockpit;
      if(design.wheel){
        const i=row.findIndex(p=>p[1]<=floorY);
        if(i>0){
          const a=row[i-1],c=row[i],fraction=(floorY-a[1])/(c[1]-a[1]);
          soleWidth=Math.min(cockpit,Math.max(0,Math.abs(a[0]+fraction*(c[0]-a[0]))-.09));
        }
      }
      const floor=[s*soleWidth,floorY,z];
      if(prev){
        const last=prev[k];
        if(buildPaint)for(let i=1;i<7;i++)addPaint(last[i-1],row[i-1],row[i],last[i]);
        panel(last[0],row[0],rim,last[7],ivory,.84);
        rod(last[0],row[0],.024,wood);
        if(cockpit || last[7][0]){
          panel(last[7],rim,floor,last[8],wood,.72);
          deck(last[8],floor,[0,floorY,z],[0,last[8][1],last[8][2]]);
          rod(last[7],rim,.034,wood);
        }
      }else if(k===1 && buildPaint){
        for(let i=1;i<7;i++)addPaint(sides[0][i-1],row[i-1],row[i],sides[0][i]);
      }
      row.push(rim,floor);
    }
    prev=sides;
  }
  if(buildPaint)brasilPaintCache.set(design.sections,paint);
  for(const [points,color] of paint){
    if(points.length===4)hull(...points,color);
    else for(let i=2;i<points.length;i++)hull(points[0],points[i-1],points[i],points[i],color);
  }
}

// Geometria em metros, proa em +Z. As estações seguem o perfil do S&S 509.
function drawBrasil40(b,design,panel,hull,rod,cloth,time,metal,rounded){
  const ivory=[.90,.88,.78],navy=[.13,.21,.24],wood=[.49,.29,.15],
    teak=[.67,.49,.31],bronze=[.68,.53,.31],glass=[.14,.23,.25],rope=[.76,.71,.56];
  wood.varnish=true;bronze.bronze=true;
  const deck=(a,c,d,e)=>cloth(a,c,d,e,teak,.8,1.30);
  drawClassicShell(design,panel,hull,rod,deck,wood,ivory,brasilStripe);
  // Long keel fairs into the forefoot. Rudder pivots about the raked sternpost.
  const profile=[[-3.98,-.06],[-2.86,-1.76],[-2.58,-1.803],[-.62,-1.78],[.48,-1.58],[2.75,-.55],[4.18,-.03]];
  for(let i=1;i<profile.length;i++){
    const section=([z,y],s)=>[[s*.23,.05,z],[s*.09,y,z]];
    for(const s of [-1,1]){
      const [a,c]=section(profile[i-1],s),[d,e]=section(profile[i],s);
      panel(a,d,e,c,brasilBottom,.85);
    }
  }
  const angle=b.rudderAngle||0;
  const blade=(z,y,reach)=>[-reach*Math.sin(angle),y,z-reach*Math.cos(angle)];
  panel(blade(-3.94,-.10,0),blade(-3.94,-.10,.19),blade(-3.23,-1.37,.49),blade(-2.87,-1.76,0),brasilBottom,.8);
  // Trunk cabin, arched roof, mahogany coamings and brass portlight rims.
  let cabin;
  for(const [z,w,top] of [[-1.86,.83,1.46],[-1.45,.93,1.49],[.2,.96,1.54],[1.63,.86,1.58],[2.72,.68,1.58]]){
    const row=[[-w,.91,z],[-w,top-.10,z],[0,top,z],[w,top-.10,z],[w,.91,z]];
    if(cabin)for(let i=1;i<5;i++)panel(cabin[i-1],row[i-1],row[i],cabin[i],i===1||i===4?wood:ivory,.78);
    if(!cabin||z===2.72)panel(row[0],row[1],row[3],row[4],wood,.8);
    cabin=row;
  }
  // Low butterfly skylight on the cabin crown and a separate forward hatch.
  function hatch(centerZ,width,length,base,rise,crown,slope){
    const point=(x,z)=>[x,base+slope*z+rise+crown*(1-Math.abs(x)/width),centerZ+z];
    const cross=[-width,0,width],ends=[-length,length];
    for(let i=1;i<cross.length;i++){
      const x=cross[i-1],u=cross[i];
      panel(point(x,-length),point(u,-length),point(u,length),point(x,length),wood,.85);
      const left=x+.043,right=u-.043;
      const pane=(x,z)=>{const v=point(x,z);v[1]+=.003;return v;};
      panel(pane(left,-length+.05),pane(right,-length+.05),pane(right,length-.05),pane(left,length-.05),glass,.86);
    }
    const skirt=(a,b)=>{
      const foot=v=>[v[0],base+slope*(v[2]-centerZ)-.05,v[2]];
      panel(foot(a),a,b,foot(b),wood,.8);
    };
    for(const z of ends)for(let i=1;i<cross.length;i++)skirt(point(cross[i-1],z),point(cross[i],z));
    for(const x of [-width,width])skirt(point(x,-length),point(x,length));
    for(const x of [-width*.53,width*.53])
      rod(point(x-.052,-length),point(x+.052,-length),.014,bronze);
  }
  hatch(-.10,.36,.44,1.53,.055,.073,.031);
  hatch(3.65,.34,.36,1.21,.058,.009,.075);
  // Varnished cockpit coamings taper aft and flare slightly at the cap.
  for(const side of [-1,1]){
    let previous;
    for(const [z,x,deckY,height] of [[-4.19,.51,.92,.045],[-3.88,.54,.92,.14],[-3,.60,.90,.195],[-1.87,.63,.91,.29]]){
      const row=[[x,deckY],[x+.027,deckY+height],[x+.076,deckY+height],[x+.066,deckY]]
        .map(([w,y])=>[side*w,y,z]);
      if(previous)for(let i=1;i<4;i++)panel(previous[i-1],row[i-1],row[i],previous[i],wood,.88);
      if(!previous||z===-1.87)panel(...row,wood,.8);
      previous=row;
    }
  }
  for(const s of [-1,1]){
    for(const [z,w,y] of [[-1.06,.947,1.27],[-.06,.966,1.30],[.96,.918,1.32],[2.05,.802,1.35]]){
      const ring=(i,r)=>[s*(w+.016),y+r*.098*Math.sin(i*Math.PI/6),z+r*.184*Math.cos(i*Math.PI/6)];
      for(let i=0;i<12;i++){
        panel(ring(i,1),ring(i+1,1),ring(i+1,.78),ring(i,.78),bronze,.72);
        panel(ring(i,.78),ring(i+1,.78),[s*(w+.016),y,z],[s*(w+.016),y,z],glass,.6);
      }
    }
    if(!b.i){
      // Fairlead cheeks and the sheet's actual lead aft from the genoa car.
      const car=[s*1.25,1.08,-1.35],winch=[s*1.21,1.10,-2.18];
      rod([car[0],1.03,-1.57],[car[0],1.04,-1.04],.025,metal);
      for(const dx of [-.026,.026])rod([car[0]+dx,1.04,-1.41],[car[0]+dx,1.13,-1.29],.021,bronze);
      rod(car,winch,.016,rope);
      for(const z of [-.75,.43,1.60]){
        rod([s*.63,1.49,z],[s*.63,1.57,z],.024,bronze);
      }
    }
    rod([s*.63,1.51,-1.29],[s*.63,1.57,1.95],.025,wood);
    for(const z of [-3.3,-2.18]){
      const x=s*(z< -3?.96:1.21);
      rod([x,.99,z],[x,1.14,z],.085,bronze);rod([x,1.14,z],[x,1.17,z],.102,metal);
      if(!b.i){
        const wrap=(a)=>[x+.088*Math.cos(a),1.032+.0065*a,z+.088*Math.sin(a)];
        let last=wrap(0);
        for(let j=1;j<=20;j++){const next=wrap(j*Math.PI/5);rod(last,next,.008,rope);last=next;}
        rod(last,[x-s*.18,1.04,z+.18],.011,rope);
      }
    }
  }
  const mast=y=>[0,y,1.47-.035*(y-1)];
  rod(mast(1),mast(15.83),.081,wood);
  const tack=[0,1.49,5.98],hounds=mast(12.22),diamond=[0,12.22,1.62];
  rod(tack,diamond,.013,metal);rod(hounds,diamond,.032,wood);
  rod(diamond,mast(15.83),.012,metal);rod(mast(15.83),[0,.98,-5.74],.013,metal);
  for(const s of [-1,1]){
    for(const [height,width] of [[7.43,1.08],[13.45,.40]]){
      const tip=[s*width,height,mast(height)[2]];
      rod(mast(height),tip,.034,wood);
      rod(tip,height<8?[s*1.33,1.04,1.33]:mast(10.8),.012,metal);
      rod(tip,mast(height<8?12.22:15.83),.012,metal);
    }
  }
  drawBrasilSpi(b,mast,rod,cloth,time,wood,metal,rope);
  for(const main of [true,false]){
    const sheet=main?b.mainSail:b.jibSail;
    const hoist=main?1:brasilGenoaHoist(b);
    function sail(v,u){
      const height=main?2.32+13.42*v:1.49+10.73*v;
      const chord=(main?5.93:5.58)*(1-v);
      const z=main?mast(height)[2]:5.98-4.36*v;
      const a=(sheet.angle||0)*(1+.11*v);
      const draft=sotoMembrane(sheet,a,v,u,chord,time,main);
      const flying=[u*chord*Math.sin(a)+draft*Math.cos(a),height+(main?0:.43*u*(1-v)),
        z-u*chord*Math.cos(a)+draft*Math.sin(a),u,v];
      return main?flying:brasilGenoaPoint(flying,v,u,hoist);
    }
    const rows=b.i?8:18,cols=b.i?4:10;
    let last;
    for(let i=0;i<=rows;i++){
      const row=Array.from({length:cols+1},(_,j)=>sail(i/rows,j/cols));
      if(last)for(let j=1;j<=cols;j++)cloth(last[j-1],last[j],row[j],row[j-1],ivory,.74,16);
      if(!b.i && i>0 && i%4===0)for(let j=1;j<=cols;j++)rod(row[j-1],row[j],.006,rope);
      last=row;
    }
    if(main){
      rod(sail(0,0),sail(0,1),.073,wood);
      rod(sail(0,.73),[0,.83,-3.15],.021,rope);
      // Historic BL sail identification printed as narrow fabric strokes.
      const stroke=(v,u,v2,u2)=>rod(sail(v,u),sail(v2,u2),.026,navy);
      stroke(.71,.23,.76,.23);stroke(.76,.23,.76,.43);stroke(.76,.43,.736,.46);
      stroke(.736,.46,.735,.23);stroke(.735,.43,.71,.46);stroke(.71,.46,.71,.23);
      stroke(.76,.54,.71,.54);stroke(.71,.54,.71,.73);
    }else rod(sail(0,1),[(b.lee||1)*1.25,1.08,-1.35],.016,rope);
  }
  const grip=[.55*Math.sin(angle),1.06,-3.10];
  rod([0,.61,-4.14],grip,.041,wood);
  for(const [i,z] of [-3.53,-2.4,-1.38,.15,1.91].entries()){
    const x=i<2?(i===0?.50:-.62):((i%2?1:-1)*1.09);
    const hip=[x,i<2?.95:1.09,z],head=[x,hip[1]+.49,z+.08];
    rod(hip,head,.128,i%2?navy:ivory);
    rounded([head[0],head[1]+.107,head[2]],[.086,.112,.088],[.68,.47,.32]);
    for(const k of [-1,1]){
      rod([head[0]+k*.10,head[1]-.10,head[2]],i===0?grip:[x+k*.11,hip[1]+.13,z+.24],.044,[.68,.47,.32]);
      const knee=[x-Math.sign(x)*.20,hip[1]-.06,z+k*.09+.17];
      rod(hip,knee,.076,navy);rod(knee,[knee[0],hip[1]-.39,knee[2]],.052,navy);
    }
  }
}

// Symmetric sail: each clew keeps its own line; sheet and guy exchange roles.
function updateBrasilSpi(b,awa,aws,twa,eased,dt){
  if(b.i && !b.remote)b.spiUp=twa>(b.spiUp?95:114);
  const lift=b.spiHoist||0,angle=Math.abs(awa);
  b.spiHoist=Math.max(0,Math.min(1,lift+dt*(b.spiUp?1/5:-1/3)));
  const windward=Math.abs(awa)>174?(b.poleTack||-b.lee||1):Math.sign(awa)||b.poleTack||1;
  b.poleTack=windward;
  const target=windward*(.27+1.22*spiRamp(65,170,angle));
  const pole=b.poleAngle??target;
  b.poleAngle=pole+Math.max(-dt*.84,Math.min(dt*.84,target-pole));
  b.spiTravel=Math.sin(b.poleAngle);
  const ideal=24+51*spiRamp(68,172,angle);
  const trim=(b.spiSheet??ideal)-ideal;
  const loading=spiRamp(56,90,angle)*spiRamp(.8,4,aws)*Math.exp(-trim*trim/1700);
  const squared=.40+.60*(1-Math.min(1,Math.abs(target-b.poleAngle)/1.3));
  const fill=b.spiUp&&!eased?loading*squared*spiRamp(.12,.8,b.spiHoist):0;
  b.spiFill=(b.spiFill||0)+(fill-(b.spiFill||0))*(1-Math.exp(-dt*(fill>(b.spiFill||0)?1.35:3.3)));
  b.spiLoad=b.spiFill*b.spiHoist*Math.min(1.8,(aws/16)**2);
  b.spiSide=-Math.sin(awa*Math.PI/180)*b.spiLoad;
}

function drawBrasilSpi(b,mast,rod,cloth,time,wood,metal,rope,rig){
  const lift=b.spiHoist||0;
  const heel=mast(2.18),angle=b.poleAngle||0;
  const pole=rig?.J??4.62;
  const tip=[heel[0]+pole*Math.sin(angle),2.25,heel[2]+pole*Math.cos(angle)];
  if(lift<.006){
    if(rig)rod([rig.beam*.34,rig.deck+.10,rig.mast],[.44,rig.tackY+.08,rig.bow-.60],.046,wood);
    else rod([.72,1.24,1.42],[.47,1.40,5.30],.046,wood);
    return;
  }
  rod(heel,tip,.052,wood);
  rod(tip,[tip[0]*.96,2.247,heel[2]+(tip[2]-heel[2])*.96],.062,metal);
  rod(mast(7.45),tip,.012,rope);
  rod(tip,[0,1.20,4.16],.013,rope);
  const fill=b.spiFill||0,travel=Math.sin(angle);
  const tackY=rig?.tackY??1.49, foreHeight=rig?.I??10.73;
  const stayZ=y=>(rig?.bow??5.98)-(y-tackY)*(rig?.J??4.36)/foreHeight;
  const headY=tackY+.04+(foreHeight+.06)*lift;
  const head=[0,headY,stayZ(headY)+.19];
  // During the transfer the kite flies on its two lines. Keep its corners
  // apart while the pole crosses the foredeck and the genoa changes sides.
  const jibAngle=b.jibSail?.angle??0;
  function attachment(side){
    return spiRamp(.12,.42,side*travel)*(1-spiRamp(.015,.16,side*jibAngle));
  }
  function corner(side){
    const weight=attachment(side);
    const y=1.64+.61*fill;
    const free=[side*(.42+2.55*fill)*pole/4.62,y,stayZ(y)+.31+.28*fill];
    return free.map((v,i)=>v+(tip[i]-v)*weight);
  }
  const port=corner(-1),starboard=corner(1);
  function point(v,u){
    const arc=Math.sin(Math.PI*u),heightArch=Math.sin(Math.PI*v);
    const round=Math.sqrt(Math.max(0,1-v*v))*(1+.17*heightArch);
    const width=(1-v)*(1-fill)+round*fill;
    const baseX=port[0]+(starboard[0]-port[0])*u;
    const x=width*baseX;
    const cornerY=port[1]+(starboard[1]-port[1])*u;
    // The middle of the foot hangs below the clews; the broad shoulders
    // taper into the halyard while the belly projects ahead of the stay.
    const y=cornerY*(1-v)+headY*v-.83*arc*(1-v)**3*fill*lift;
    const side=x<0?port:starboard;
    const fraction=Math.abs(baseX/side[0]);
    const camber=Math.cos(Math.PI*.5*fraction);
    const setback=side[2]-stayZ(side[1]);
    const depth=lift*width*(.30+fill*(1.68+1.28*heightArch));
    const ripple=(1-fill)*.085*Math.sin(time*8-11*v+6*u)*arc*heightArch;
    return [x,y,stayZ(y)+.19*v+(1-v)*(.31+(setback-.31)*fraction*fraction)
      +depth*camber+ripple];
  }
  const windward=travel<0?-1:1;
  if(attachment(windward)<.999)rod(tip,windward<0?port:starboard,.014,rope);
  rod([0,tackY+foreHeight,stayZ(tackY+foreHeight)],head,.012,rope);
  drawSpiFabric(point,b.i?12:32,b.i?10:24,[.98,.975,.95],cloth);
  for(const side of [-1,1]){
    const clew=side<0?port:starboard,block=rig?[side*rig.beam*.31,rig.deck+.04,-rig.length*.34]:[side*1.04,1.02,-3.92];
    const color=side<0?[.56,.19,.13]:[.16,.34,.28];
    rod(clew,block,.018,color);rod(block,rig?[side*rig.beam*.31,rig.deck+.18,-rig.length*.28]:[side*.96,1.14,-3.3],.017,color);
  }
}
