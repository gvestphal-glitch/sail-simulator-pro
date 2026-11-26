"use strict";
// ORC International 044200051RM, ONDA (BRA 2779), 16 October 2026.
const sotoWind=[4,6,8,10,12,14,16,20,24];
const sotoBeat=[45.2,42.6,40.3,38.6,37.9,37.8,37.6,37.7,39];
const sotoRun=[139.3,141.1,143.9,147.4,151.1,148.3,146.7,146.2,150.1];
const beatVMG=[3.12,4.42,5.27,5.65,5.85,5.98,6.07,6.13,6.00];
const runVMG=[3.11,4.53,5.73,6.73,7.57,8.39,9.38,11.83,15.02];
const sotoReaches=[
 [52,4.87,6.70,7.74,8.11,8.32,8.47,8.59,8.74,8.66],
 [60,5.24,7.07,8.03,8.41,8.65,8.84,8.99,9.19,9.17],
 [75,5.54,7.33,8.25,8.81,9.17,9.44,9.67,9.99,10.11],
 [90,5.40,7.21,8.20,8.91,9.54,9.98,10.34,10.92,11.32],
 [110,5.05,7.10,8.30,8.97,9.53,10.06,10.70,12.04,13.04],
 [120,4.86,6.95,8.29,9.23,9.93,10.57,11.20,12.43,13.55],
 [135,4.34,6.26,7.86,8.83,9.89,11.06,12.16,13.85,15.59],
 [150,3.59,5.23,6.62,7.78,8.73,9.68,10.83,13.66,17.34]
];
const sotoCurves=sotoWind.map((_,i)=>{
 const radians=Math.PI/180;
 return [[0,0],[sotoBeat[i]-12,0],[sotoBeat[i],beatVMG[i]/Math.cos(sotoBeat[i]*radians)],
 ...sotoReaches.map(row=>[row[0],row[i+1]]),[sotoRun[i],-runVMG[i]/Math.cos(sotoRun[i]*radians)],
 [180,runVMG[i]*.91]].sort((a,b)=>a[0]-b[0]);
});
function sotoSpeed(wind,angle){
 const at=curve=>{
   const hi=curve.findIndex(row=>row[0]>=angle);
   if(hi<=0)return hi===0?0:curve.at(-1)[1];
   const [x,a]=curve[hi-1],[y,b]=curve[hi];
   return a+(b-a)*(angle-x)/(y-x);
 };
 if(wind<=sotoWind[0])return at(sotoCurves[0])*Math.max(0,wind)/sotoWind[0];
 const hi=sotoWind.findIndex(v=>v>=wind);
 if(hi<0)return at(sotoCurves.at(-1));
 const lo=hi-1;
 return at(sotoCurves[lo])+(at(sotoCurves[hi])-at(sotoCurves[lo]))*(wind-sotoWind[lo])/(sotoWind[hi]-sotoWind[lo]);
}
function sotoSailChoice(wind){return wind<12?1:wind<20?2:3;}
function updateSotoInventory(b,wind,twa,dt,swan=false){
 if(!b.remote){
   if(!b.jibManual){
     const current=b.jibNumber;
     if(swan)b.jibNumber=current===2?(wind<14?1:2):(wind>15?2:1);
     else if(!current || current===1&&wind>=13 || current===2&&(wind<11||wind>=21) || current===3&&wind<19)
       b.jibNumber=sotoSailChoice(wind);
   }
   if(b.i)b.spiUp=twa>(b.spiUp?90:105);
 }

 let travel=b.halyardCrew??0, lift=b.spiHoist??0;
 if(b.spiUp && lift<1){
   const approach=Math.min(dt,(1-travel)*1.4);
   if(!travel)b.hoistSide=Math.sign(b.crewOffset)||1;
   travel=Math.min(1,travel+approach/1.4);
   lift=Math.min(1,lift+Math.max(0,dt-approach)/4.8);
 }else{
   travel=Math.max(0,travel-dt/1.65);
   if(!b.spiUp)lift=Math.max(0,lift-dt/2.4);
 }
 b.halyardCrew=travel;
 b.spiHoist=lift;
 if(b.spiUp)b.halyardPhase=lift*12*Math.PI;
}
function spiRamp(low,high,value){
 const t=Math.max(0,Math.min(1,(value-low)/(high-low)));
 return t*t*(3-2*t);
}
// Independent loads preserve tension on the old runner until the new one takes up.
function updateRunners(b,awa,wind,dt){
 const side=Math.abs(Math.sin(awa))>.12?Math.sign(awa):(b.runnerWindward||Math.sign(awa)||1);
 b.runnerWindward=side;
 const target=(.12+.88*spiRamp(2,24,wind))*(1-.18*spiRamp(95,165,Math.abs(awa)*180/Math.PI));
 if(!b.runnerLoads)b.runnerLoads=[side<0?target:0,side>0?target:0];
 const active=side>0?1:0,old=1-active,loads=b.runnerLoads;
 const prior=loads[active];
 loads[active]+=(target-prior)*(1-Math.exp(-dt*1.6));
 if(loads[active]>=.45*target)loads[old]*=Math.exp(-dt*4.8);
 b.backstayPhase=((b.backstayPhase||0)+Math.max(0,loads[active]-prior)*27)%(2*Math.PI);
}
function sotoIdealSpi(awa){return 18+62*spiRamp(48,155,awa);}
// Gameplay calibration for the ONDA asymmetric, using apparent angles and true wind in knots.
function updateSotoKite(b,awa,aws,tws,eased,dt){
 const lift=b.spiHoist||0;
 if(!lift){
   b.runnerTime=undefined;b.spiTravel=undefined;b.spiShoulder=undefined;b.spiDestination=undefined;
   b.spiFill=0;b.spiLoad=0;b.spiFlutter=0;b.spiSide=0;b.spiBeat=0;
   return;
 }
 const angle=Math.abs(awa), breeze=spiRamp(8,20,tws);
 const edge=42+16*breeze, shadow=139+19*breeze;
 const entry=spiRamp(edge,edge+16,angle);
 const clearAir=1-.87*spiRamp(shadow,179,angle);
 const airflow=spiRamp(.6,3,aws);
 // Keep the loaded sheet through the dead-downwind wind-direction dead band.
 // The clew travels first; the shoulder follows as the new sheet takes load.
 const windSide=-Math.sign(awa)||b.lee||1;
 if(b.spiDestination!=null && b.spiDestination!==windSide && angle>95 && angle<175 && lift>.8){
   b.runnerTime=0;b.runnerSide=windSide;
 }
 if(b.runnerTime!=null){
   b.runnerTime+=dt;
   if(b.runnerTime>=5 || !b.spiUp)b.runnerTime=undefined;
 }
 if(b.spiDestination==null || (angle<175 && angle>3))b.spiDestination=windSide;
 const old=b.spiTravel??b.spiDestination;
 const rate=.65+.70*spiRamp(2,18,aws);
 b.spiTravel=old+Math.max(-dt*rate,Math.min(dt*rate,b.spiDestination-old));
 const shoulder=b.spiShoulder??old;
 b.spiShoulder=shoulder+(b.spiTravel-shoulder)*(1-Math.exp(-dt*(2.2+airflow)));
 const supported=spiRamp(.12,.92,b.spiDestination*(.67*b.spiTravel+.33*b.spiShoulder));
 const ideal=sotoIdealSpi(angle);
 const error=((b.spiSheet??ideal)-ideal)/100;
 const sheetEfficiency=Math.exp(-(error>0?8:4)*error*error);
 const target=supported*entry*clearAir*airflow*sheetEfficiency*(eased?.07:1);
 const prior=b.spiFill||0;
 b.spiFill=prior+(target-prior)*(1-Math.exp(-dt*(target<prior?3.8:.85+.85*airflow)));
 b.spiBeat=((b.spiBeat||0)+dt*(6+Math.min(32,aws)*.48))%(Math.PI*200);
 b.spiFlutter=(1-b.spiFill)*airflow;
 // A collapsed sail streams aft. Brief asymmetric catches add intermittent side force.
 const snap=(.5+.5*Math.sin(b.spiBeat))**4;
 const lateral=Math.sin(awa*Math.PI/180);
 const pressure=Math.min(2.8,(aws/17)**2)*lift*lift;
 const catchLoad=(1-b.spiFill)*(.04+.46*snap)*(eased?.23:1);
 b.spiLoad=pressure*(b.spiFill*1.18+catchLoad)*Math.abs(lateral);
 b.spiSide=b.spiTravel*b.spiLoad;
}
// u runs from luff to leech, v from tack to head. Both corners of
// the luff remain pinned while the free clew sweeps forward around the stay.
function flyingSpi(b,v,u,tack,head,width,foot,clock){
 const lift=b.spiHoist||0,fill=b.spiFill||0,beat=b.spiBeat||0;
 const clew=b.spiTravel??b.lee??1,shoulder=b.spiShoulder??clew;
 const side=clew+(shoulder-clew)*v;
 const sweep=Math.sin(side*Math.PI/2),forward=Math.cos(side*Math.PI/2);
 const span=1-v,arch=Math.sin(Math.PI*v),across=Math.sin(Math.PI*u);
 const sheet=((b.spiSheet??50)-50)/100;
 const shoulderWidth=width*.47*arch, skirt=width*(1+.42*sheet)*u*span;
 const shape=arch*(1-.52*u)+across*span;
 const curl=Math.exp(-6*u)*arch*Math.max(0,Math.sin(.64*beat-5*v))**2;
 const flutter=(b.spiFlutter||0)*(.18*Math.sin(beat-9*v-6*u)+.09*Math.sin(1.72*beat-15*v+4*u))*shape;
 const ripple=flutter+.034*fill*shape*Math.sin(2.1*clock-4*v-3*u);
 const inflation=.23+.77*fill;
 const spread=(shoulderWidth+skirt+.15*width*across*span)*inflation;
 const belly=.39*width*fill*(arch+across*span);
 const aft=foot*(1-.21*sheet)*u*span;
 return [
   lift*(sweep*(spread-.43*curl*(1-.65*fill))+ripple),
   tack[1]+lift*((head[1]-tack[1])*v+(1.05+.66*fill)*u*span-.16*span*across+.23*ripple),
   tack[2]+lift*((head[2]-tack[2])*v-aft*Math.abs(sweep)+forward*(.46*foot*u*span+shoulderWidth)
     +belly-(1-fill)*shape*.92+.36*ripple)
 ];
}
function drawFlyingSpi(b,tack,head,width,foot,clock,color,cloth){
 const rows=b.i?9:30,cols=b.i?6:19;
 const point=(v,u)=>flyingSpi(b,v,u,tack,head,width,foot,clock);
 drawSpiFabric(point,rows,cols,color,cloth);
 return point;
}
function drawSpiFabric(point,rows,cols,color,cloth){
 const grid=Array.from({length:rows+1},(_,i)=>Array.from({length:cols+1},(_,j)=>
   [...point(i/rows,j/cols),j/cols,i/rows]));
 for(let i=0;i<=rows;i++)for(let j=0;j<=cols;j++){
   const a=grid[i][Math.max(0,j-1)],c=grid[i][Math.min(cols,j+1)];
   const lo=grid[Math.max(0,i-1)][j],hi=grid[Math.min(rows,i+1)][j];
   const x=c[0]-a[0],y=c[1]-a[1],z=c[2]-a[2];
   const dx=hi[0]-lo[0],dy=hi[1]-lo[1],dz=hi[2]-lo[2];
   const nx=y*dz-z*dy,ny=z*dx-x*dz,nz=x*dy-y*dx;
   const len=Math.hypot(nx,ny,nz)||1;
   grid[i][j].push(nx/len,ny/len,nz/len);
 }
 for(let i=1;i<=rows;i++)for(let j=1;j<=cols;j++)
   cloth(grid[i-1][j-1],grid[i-1][j],grid[i][j],grid[i][j-1],color,.6,17);
}
function drawSpiSheets(b,clew,tack,beam,height,quarterZ,line,color){
 const travel=b.spiTravel??b.lee??1;
 for(const side of [-1,1]){
   const block=[side*beam,height,quarterZ];
   const slack=.5*(1-side*travel);
   const middle=clew.map((q,k)=>(q+block[k])*.5);
   // The lazy sheet leads around the outside of the tack. Blend its path
   // into the loaded, straight lead as the clew comes across the bow.
   middle[0]+=(side*(beam+.18)-middle[0])*slack;
   middle[1]+=(Math.max(.57,tack[1]-.18)-middle[1])*slack;
   middle[2]+=(tack[2]+.13-middle[2])*slack;
   line(clew,middle,.013,color);line(middle,block,.013,color);
 }
}
// One rail sailor carries the tail from the turning block aft toward the trimmer.
function drawSheetRunner(b,rail,block,line,rope,jersey){
 if(b.runnerTime==null)return false;
 const t=b.runnerTime,side=b.runnerSide;
 const approach=spiRamp(0,1.1,t),run=spiRamp(1.1,3.2,t),back=spiRamp(3.55,5,t);
 const blend=(a,z,w)=>a+(z-a)*w;
 const x=blend(blend(rail[0],side*Math.abs(block[0])*.80,approach),rail[0],back);
 const z=blend(blend(rail[2],.68,approach)-run*(.68-block[2]-.6),rail[2],back);
 const stand=approach*(1-back),stride=Math.sin(9*t)*Math.sin(Math.PI*run);
 const hip=[x,rail[1]+stand*(.42+.06*Math.abs(stride)),z];
 const neck=[x,hip[1]+.49,z-.12*stand],skin=[.72,.50,.36];
 line(hip,neck,.14,jersey);line(neck,[x,neck[1]+.20,neck[2]],.091,skin);
 for(const a of [-1,1]){
   const knee=[x+.11*a,hip[1]-.17,z+.22*a*stride];
   const boot=[x+.14*a,knee[1]-.24+.12*Math.max(0,a*stride),z-.23*a*stride];
   line(hip,knee,.077,jersey);line(knee,boot,.053,[.13,.14,.16]);
   const elbow=[x+.16*a,neck[1]-.24,z-.09];
   const hand=[x+.22*a,elbow[1]-.04,z+.18+.09*a*stride];
   line(neck,elbow,.055,jersey);line(elbow,hand,.043,skin);
   if(a===side && t>=1 && t<3.55)line([side*Math.abs(block[0]),block[1],block[2]],hand,.019,rope);
 }
 return true;
}
function sotoSailFactor(b,wind,twa,swan=false){
 if(swan){
   const running=spiRamp(96,124,twa);
   const mismatch=(b.jibNumber||1)!==(wind>15?2:1);
   const hoist=b.spiHoist||0, fill=b.spiFill||0;
   return (1-(mismatch?.055:0)*(1-running))*(1-.34*running*(1-hoist*fill)-hoist*(1-running)*.12);
 }
 const reach=spiRamp(72,116,twa);
 const penalty=Math.abs((b.jibNumber||1)-sotoSailChoice(wind))*.055;
 const lift=b.spiHoist||0,fill=b.spiFill||0;
 return (1-penalty*(1-reach))*(1-.31*reach*(1-lift*fill)
   -lift*((1-reach)*.18+.075*(1-fill)));
}

// Draft is normal to the chord. Pin the corners and the foot of the boom.
function sotoMembrane(sail,angle,v,u,chord,clock,main){
 const arch=4*u*(1-u)*(1.17-.42*u);
 const foot=main?spiRamp(0,.16,v):1;
 const pressure=Math.tanh(angle*10)*(sail.camber||0)*arch;
 const flutter=(sail.flutter||0)*(.044*Math.sin(clock*12-10*u-7*v)
   +.018*Math.sin(clock*19-18*u+4*v))*Math.sin(Math.PI*v)*u*(1.5-.5*u);
 return foot*chord*(pressure+flutter);
}
// Original mesh built from the OD profile, published principal dimensions and rig layout.
function drawSoto40(b,design,panel,hull,line,cloth,clock,metal,rounded){
 const deck=[.88,.89,.85],shell=[.92,.94,.93],carbon=[.12,.15,.16];
 const stripe=[.82,.87,.88],aft=-6.17;
 const fine=!b.i, sole=[.43,.45,.46], ropeBlue=[.19,.55,.74], ropeRed=[.79,.31,.20];
 function section(z,half,edge,side){
   const x=side*half;
   // The stern quarters turn outboard just below the sheer. Fair the flare
   // into the topsides towards midships, inside the measured maximum beam.
   const flare=.12*(1-spiRamp(-4.8,-.8,z));
   return [[x,edge,z],[x-side*flare*.12,edge-.018,z],
     [x*.997-side*flare*.51,edge-.052,z],[x*.995-side*flare*.86,edge-.106,z],
     [x*.984-side*flare,edge-.18,z],[x*.925,.55,z],
     [x*.85,.01,z],[x*.58,-.38,z],[0,-.56,z]];
 }
 let previous;
 for(const [z,width,edge,opening] of design.sections){
   const outer=section(z,width,edge,1),port=section(z,width,edge,-1);
   const floor=.55;
   for(const side of [-1,1]){
     const row=side<0?port:outer,inner=[side*opening,edge,z],lower=[side*opening,floor,z];
     if(previous){
       const last=previous[side<0?0:1],oldInner=[side*previous[2],last[0][1],last[0][2]],oldLower=[oldInner[0],floor,oldInner[2]];
       for(let i=1;i<row.length;i++)hull(last[i-1],row[i-1],row[i],last[i],i===3?stripe:shell);
       cloth(last[0],row[0],inner,oldInner,deck,.75,1);
       panel(oldInner,inner,lower,oldLower,[.66,.71,.70],.7);
       if(opening||previous[2]){
         cloth(oldLower,lower,[0,floor,z],[0,floor,oldLower[2]],sole,.60,15);
         if(fine && opening>.15 && previous[2]>.15){
           const x=side*.055;
           panel([x,floor+.006,z],[x+side*.020,floor+.006,z],[x+side*.020,floor+.006,oldLower[2]],[x,floor+.006,oldLower[2]],shell,.74);
         }
       }
     }
   }
   if(!previous){
     // Use the same outline as the planking so the rounded lip carries
     // around both quarters without sealing the cockpit above the sole.
     const soleIndex=5;
     for(const side of [-1,1]){
       const outline=side<0?port:outer;
       for(let i=1;i<=soleIndex;i++){
         const high=outline[i-1],low=outline[i];
         hull(high,[side*opening,high[1],z],[side*opening,low[1],z],low,shell);
       }
     }
     for(let i=soleIndex+1;i<outer.length;i++)hull(port[i-1],outer[i-1],outer[i],port[i],shell);
   }
   previous=[port,outer,opening];
 }
 // Foil sections taper from the canoe body to the ballast bulb and rudder tip.
 function foil(root,tip,width,angle){
   const section=(row,phi)=>{
     const x=width*row[2]*Math.sin(phi),z=row[2]*Math.cos(phi);
     return [x*Math.cos(angle)+z*Math.sin(angle),row[1],row[0]+z*Math.cos(angle)-x*Math.sin(angle)];
   };
   for(let k=0;k<8;k++){
     const a=k*Math.PI/4,c=a+Math.PI/4;
     hull(section(root,a),section(root,c),section(tip,c),section(tip,a),shell);
   }
 }
 foil([.10,-.40,.68],[-.17,-2.65,.36],.14,0);
 foil([-4.85,.0,.46],[-5.12,-1.86,.19],.13,b.rudderAngle||0);
 for(let i=0;i<6;i++){
   const bulb=(j,k)=>{
     const a=Math.PI*j/6,c=Math.PI*k/4;
     return [.24*Math.sin(a)*Math.cos(c),-2.639+.23*Math.sin(a)*Math.sin(c),-.18+1.15*Math.cos(a)];
   };
   for(let k=0;k<8;k++)hull(bulb(i,k),bulb(i+1,k),bulb(i+1,k+1),bulb(i,k+1),shell);
 }
 const stick=(a,c,r=.017,color=carbon)=>line(a,c,r,color);
 // Paired cheeks, axle and sheave share a centre with the rope lead.
 function turningBlock(x,y,z,r){
   for(const offset of [-.58,.58]){
     const face=x+r*offset;
     stick([face,y-r*.68,z-r*.14],[face,y+r*.63,z+.012],r*.44,carbon);
   }
   stick([x-r*.43,y,z],[x+r*.43,y,z],r*.79,[.34,.39,.38]);
   stick([x-r*.84,y,z],[x+r*.84,y,z],r*.21,metal);
 }
 function ropeTail(x,z,side,color){
   const start=[x,.575,z];
   stick([side*1.49,1.09,z+.37],start,.014,color);
   let last=start;
   for(let k=1;k<=25;k++){
     const a=k*Math.PI/8;
     const next=[x+side*.15*Math.sin(a),.575+.008*k/25,z+.27*(Math.cos(a)-1)-.003*k];
     stick(last,next,.014,color);last=next;
   }
 }
 const mast=[0,19.19,.67],tack=[0,1.12,6.01],tip=[0,1.14,8.30];
 stick([0,1.02,1.0],mast,.092);stick(tack,tip,.082);
 stick(mast,tack,.014);stick(tip,[0,.32,6.1],.014);
 for(const side of [-1,1]){
   let stay=[side*1.68,1.00,.43];
   for(const [height,width] of [[7.2,1.55],[12.8,1.00]]){
     const end=[side*width,height,.37];stick([0,height,.90],end,.038);stick(stay,end,.015);stay=end;
   }
   stick(stay,mast,.013);
   const runnerBlock=[side*1.66,1.03,aft+.23];
   stick(mast,runnerBlock,.014);
   stick([runnerBlock[0],.95,runnerBlock[2]],runnerBlock,.033,metal);
   stick(runnerBlock,[side*1.58,1.12,-5.51],.012,ropeBlue);
   let last;
   for(const [z,width,y] of design.stations.filter(row=>row[1]>.01)){
     const foot=[side*width*.98,y,z],top=[foot[0],y+.55,z];
     stick(foot,top,.012,metal);
     if(fine){
       stick(foot,[foot[0],y+.018,z],.041,metal);
       if(last)stick([last[0],last[1]-.25,last[2]],[top[0],top[1]-.25,top[2]],.006,metal);
     }
     if(last)stick(last,top,.008,metal);last=top;
   }
   for(const [z,x,y] of [[-4.15,1.63,.97],[-2.15,1.55,1],[-.92,1.43,1.025]]){
     const rope=z<-3?ropeRed:ropeBlue;
     const rings=[[0,.136],[.026,.141],[.055,.11],[.08,.087],[.172,.085],[.20,.116],[.22,.114],[.231,.077]];
     const steps=fine?20:6;
     const vertex=(height,r,a)=>[side*x+r*Math.cos(a),y+height,z+r*Math.sin(a)];
     for(let j=1;j<rings.length;j++)for(let k=0;k<steps;k++){
       const a=k*2*Math.PI/steps,c=(k+1)*2*Math.PI/steps;
       panel(vertex(...rings[j-1],a),vertex(...rings[j-1],c),vertex(...rings[j],c),vertex(...rings[j],a),
         j===2||j===6?metal:k%3===0?[.20,.23,.24]:carbon,.9);
     }
     stick([side*x,y+.214,z],[side*x,y+.238,z],.069,carbon);
     if(fine){
       // Raised self-tailing jaws, dark drive socket and contrasting drum flutes.
       stick(vertex(.235,0,0),vertex(.244,0,0),.035,[.035,.045,.047]);
       for(let k=0;k<10;k++){
         const a=k*Math.PI/5;
         stick(vertex(.070,.099,a),vertex(.166,.087,a+.13),.0045,metal);
       }
       stick(vertex(.215,.13,.8),vertex(.257,.066,1.55),.014,metal);
       let prev=vertex(.087,.092,0);
       for(let k=1;k<=20;k++){
         const pt=vertex(.087+.051*k/20,.092,k*Math.PI/5);
         stick(prev,pt,.009,rope);prev=pt;
       }
       const guide=[side*(x-.18),y+.11,z+.42];
       stick(prev,guide,.011,rope);stick(guide,[side*(x-.25),1.06,z+.75],.009,rope);
       turningBlock(guide[0],guide[1],guide[2],.059);
       if(z===-2.15){
         const exit=vertex(.141,.094,0);
         stick(exit,[side*1.49,1.09,z-.12],.014,rope);
         ropeTail(side*.91,z-.49,side,rope);
       }
     }
   }
   if(fine){
     for(const z of [-4.95,-3.25,-1.7]){
       const x=side*.79,base=.558,peak=.694;
       panel([x,base,z-.26],[x,base,z+.26],[x+side*.09,peak,z+.20],[x+side*.09,peak,z-.20],deck,.8);
       panel([x+side*.09,peak,z-.20],[x+side*.09,peak,z+.20],[x+side*.13,base,z+.26],[x+side*.13,base,z-.26],shell,.7);
     }
     for(let k=0;k<3;k++){
       const x=side*(.55+k*.104),z=-.61;
       stick([x,1.044,z],[x,1.08,z+.21],.037,carbon);
       stick([x,1.095,z+.035],[x,1.123,z+.155],.016,metal);
       stick([side*.13,1.14,.92],[x,1.07,z+.24],.009,k===1?ropeRed:ropeBlue);
       stick([x,1.07,z],[x,.57,-1.4-k*.25],.009,k===1?ropeRed:ropeBlue);
     }
     const heel=[side*1.63,.94,-6.10],rail=[side*1.63,1.54,-6.10];
     stick(heel,rail,.019,metal);stick(rail,[side*1.72,1.53,-5.24],.018,metal);
   }
 }
 const travel=[Math.sin(b.mainSail.angle||0)*.63,.67,-3.85];
 stick([-1.23,.61,-3.85],[1.23,.61,-3.85],.039,metal);
 stick([travel[0]-.084,.648,-3.85],[travel[0]+.084,.648,-3.85],.049,carbon);
 const tiller=b.rudderAngle||0;
 stick([0,.62,-5.37],[Math.sin(tiller)*1.62,.92,-5.37+1.62*Math.cos(tiller)],.059,shell);
 const hatch=[.055,.084,.095];
 panel([-.51,.58,-.81],[.51,.58,-.81],[.46,1.005,-.80],[-.46,1.005,-.80],hatch,.72);
 if(fine){
   // Cabin entrance trim and the two coachroof handrails.
   for(const side of [-1,1]){
     stick([side*.51,.585,-.82],[side*.46,1.016,-.82],.025,metal);
     stick([side*.68,1.066,.06],[side*.68,1.126,.15],.017,metal);
     stick([side*.68,1.126,.15],[side*.66,1.126,.61],.017,metal);
     stick([side*.66,1.126,.61],[side*.66,1.066,.70],.017,metal);
     stick([side*1.16,1.074,-.22],[side*1.16,1.074,.81],.024,metal);
     for(const z of [-.18,.05,.28,.51,.74])
       stick([side*1.16,1.09,z],[side*1.16,1.095,z],.012,carbon);
   }
   stick([-.46,1.016,-.82],[.46,1.016,-.82],.025,metal);
   for(const z of [2.12,3.65]){
     panel([-.29,1.079,z-.32],[.29,1.079,z-.32],[.29,1.079,z+.32],[-.29,1.079,z+.32],metal,.9);
     panel([-.25,1.085,z-.27],[.25,1.085,z-.27],[.25,1.085,z+.27],[-.25,1.085,z+.27],hatch,.9);
     for(const x of [-.20,.20])
       stick([x-.043,1.09,z-.28],[x+.043,1.09,z-.28],.019,metal);
     stick([-.095,1.10,z+.14],[.095,1.10,z+.14],.016,metal);
   }
 }
 function surface(point,rows,cols,color,kind=2){
   let prior;
   for(let i=0;i<=rows;i++){
     const row=Array.from({length:cols+1},(_,j)=>[...point(i/rows,j/cols),j/cols,i/rows]);
     if(prior)for(let j=1;j<=cols;j++)cloth(prior[j-1],prior[j],row[j],row[j-1],color(i,j),kind===17?.88:.73,kind);
     prior=row;
   }
 }
 const n=fine?24:7,m=fine?14:4,ma=b.mainSail.angle||0,ja=b.jibSail.angle||0;
 const heights=[0,.25,.50,.75,.875,1],widths=[5.85,4.95,4.01,2.83,2.07,1.62];
   const main=(v,u)=>{
   const k=heights.findIndex((h,i)=>i>0&&h>=v);
   const chord=widths[k-1]+(widths[k]-widths[k-1])*(v-heights[k-1])/(heights[k]-heights[k-1]);
   const offset=u*chord,ang=ma*(1+.14*v);
   const draft=sotoMembrane(b.mainSail,ma,v,u,chord,clock,true);
   return [Math.sin(ang)*offset+Math.cos(ang)*draft,2.81+16.23*v,
     .99-.32*v-Math.cos(ang)*offset+Math.sin(ang)*draft];
 };
 stick(main(0,0),main(0,1),.09);
 surface(main,n,m,()=>[.32,.32,.29],18);
 const boomBlock=main(0,.84);
 if(fine){
   turningBlock(travel[0],.72,travel[2],.096);
   turningBlock(boomBlock[0],boomBlock[1]-.09,boomBlock[2],.084);
 }
 for(const off of [-.032,.032])stick([travel[0]+off,.70,travel[2]],[boomBlock[0]+off,boomBlock[1]-.07,boomBlock[2]],.012,ropeBlue);
 stick([0,1.15,.99],main(0,.32),.031,metal);
 if(fine){
   // Keep the reinforcement pockets on the curved surface as the sail twists.
   for(const h of [.25,.48,.70,.87]){
     let last=main(h,.57);
     for(const u of [.71,.85,1]){
       const next=main(h,u);stick(last,next,.012,[.39,.40,.36]);last=next;
     }
   }
   for(const v of [.31,.57,.77]){
     const start=main(v,.98),end=main(v,1);
     stick(end,[end[0]+(end[0]-start[0])*.9+.03*Math.sin(clock*8+v),
       end[1]-.05,end[2]+(end[2]-start[2])*1.6],.009,[.78,.25,.16]);
   }
 }
 const number=b.jibNumber||1,luff=[0,16.21,16.22,14.20][number],width=[0,5.22,5.19,5.11][number];
 const jib=(v,u)=>{
   const chord=width*(1-v),dist=chord*u, ang=ja*(1+.17*v);
   const draft=sotoMembrane(b.jibSail,ja,v,u,chord,clock,false);
   return [dist*Math.sin(ang)+Math.cos(ang)*draft,1.12+Math.sqrt(luff*luff-(5.02*luff/16.22)**2)*v+.43*(1-v)*u,
     6.01-5.02*luff/16.22*v-dist*Math.cos(ang)+Math.sin(ang)*draft];
 };
 surface(jib,n,m,()=>[.42,.43,.39],16);
 const sheetSide=b.lee||1, jibCar=[sheetSide*1.16,1.16,.18];
 stick(jib(0,1),jibCar,.018,ropeBlue);
 stick(jibCar,[sheetSide*1.55+.09,1.087,-2.15],.017,ropeBlue);
 if(fine){
   turningBlock(jibCar[0],jibCar[1],jibCar[2],.073);
   // The luff tape, leech ribbons and draft stripes follow each jib's cut.
   for(const v of [.29,.54,.76]){
     const a=jib(v,.16),end=jib(v,.23);
     stick(a,[end[0]+.025*Math.sin(clock*8+v),end[1]-.035,end[2]],.011,[.81,.27,.18]);
   }
   stick(jib(0,0),jib(1,0),.022,[.68,.69,.62]);
 }
 const lift=b.spiHoist||0;
 if(lift>.015){
   const spi=drawFlyingSpi(b,tip,mast,5.1,7.95,clock,[.97,.97,.94],cloth);
   stick([.035,19.19,.67],spi(1,0),.012,[.74,.36,.13]);
   const clew=spi(0,1);
   if(fine){
     for(const u of [.86,.93])stick(spi(.06,u),clew,.022,[.75,.78,.76]);
     const ring=(k)=>[clew[0]+.042*Math.cos(k*Math.PI/4),clew[1]+.042*Math.sin(k*Math.PI/4),clew[2]];
     for(let k=0;k<8;k++)stick(ring(k),ring(k+1),.009,metal);
   }
   drawSpiSheets(b,clew,tip,1.71,1.07,-5.02,stick,ropeRed);
   for(const side of [-1,1]){
     const quarter=[side*1.71,1.07,-5.02];
     stick(quarter,[side*1.63+.09,1.06,-4.15],.015,ropeRed);
     if(fine)turningBlock(quarter[0],quarter[1],quarter[2],.078);
   }
 }
 // Lead the halyard down the mast, through a deck turning block and to
 // the cabin-top winch. The crank and the pit sailor share a grip point.
 const travelCrew=b.halyardCrew||0, progress=spiRamp(0,1,travelCrew);
 const working=b.spiUp && travelCrew>.995 && lift<1;
 const phase=b.halyardPhase||0, rope=[.74,.36,.13];
 const crank=[.79+.17*Math.cos(phase),1.33,-.50+.17*Math.sin(phase)];
 stick([.79,1.035,-.50],[.79,1.085,-.50],.135,metal);
 stick([.79,1.082,-.50],[.79,1.245,-.50],.09,carbon);
 stick([.79,1.237,-.50],[.79,1.267,-.50],.12,metal);
 stick([.79,1.27,-.50],[crank[0],1.285,crank[2]],.019,carbon);
 stick([crank[0],1.28,crank[2]],crank,.024,carbon);
 const pullY=2.12+.31*Math.cos(phase),hand=[.14+(working?.14*(2.44-pullY):0),pullY,.94];
 stick([.074,18.96,.68],hand,.011,rope);
 stick(hand,[.12,1.14,.99],.011,rope);
 stick([.12,1.14,.99],[.70,1.13,-.50],.012,rope);
 if(fine){
   let prev=[.70,1.13,-.50];
   for(let k=1;k<=22;k++){
     const theta=k*Math.PI/5+Math.PI;
     const next=[.79+.09*Math.cos(theta),1.13+k*.0038,-.50+.09*Math.sin(theta)];
     stick(prev,next,.009,rope);prev=next;
   }
   stick(prev,[.61,.61,-1.08],.01,rope);
 }
 const railSide=Math.sign(b.crewOffset)||1,skin=[.70,.49,.35];
 const mix=(a,c,t)=>a.map((x,j)=>x+(c[j]-x)*t);
 const effort=b.extraHike||0;
 const winchZ=-5.51,winchX=1.58;
 const crankAngle=b.backstayPhase||0;
 const backstayGrip=[railSide*(winchX+.14*Math.cos(crankAngle)),1.29,winchZ+.14*Math.sin(crankAngle)];
 for(const side of [-1,1]){
   stick([side*winchX,.95,winchZ],[side*winchX,.99,winchZ],.114,metal);
   stick([side*winchX,.99,winchZ],[side*winchX,1.15,winchZ],.084,carbon);
   stick([side*winchX,1.15,winchZ],[side*winchX,1.18,winchZ],.105,metal);
 }
 stick([railSide*winchX,1.18,winchZ],[backstayGrip[0],1.21,backstayGrip[2]],.019,metal);
 stick([backstayGrip[0],1.21,backstayGrip[2]],backstayGrip,.024,carbon);
 const helmHand=[railSide*.54,1.18,-4.23];
 stick([Math.sin(tiller)*1.62,.92,-5.37+1.62*Math.cos(tiller)],helmHand,.017,carbon);
 for(let i=0;i<8;i++){
   const mastCrew=i===6,pitCrew=i===5,assigned=mastCrew||pitCrew;
   const t=assigned?progress:0,side=t>0?(b.hoistSide||railSide):railSide;
   const helm=i===0,runner=i===7;
   const z=runner?-5.68:-4.5+i*.82;
   const x=side*(helm?.65:runner?1.38:1.42);
   if(i===4 && drawSheetRunner(b,[x,1.03,z],[1.71,1.07,-5.02],stick,ropeRed,[.11,.18,.21]))continue;
   const hike=helm?0:effort*(1-t);
   const lean=.21+1.01*hike;
   const station=mastCrew?[.35,1.92,.88]:[.74,1.08,-.99];
   const stride=Math.sin(Math.PI*travelCrew)*Math.sin(4*Math.PI*travelCrew)*(assigned?1:0);
   const seat=mix([x,1.03,z],station,t);
   seat[1]+=.13*Math.sin(Math.PI*t);
   const neck=mix([x+side*.60*Math.sin(lean),1.03+.60*Math.cos(lean),z+(runner?.14:.08)],mastCrew?[.27,2.41,.91]:[.76,1.46,-.72],t);
   neck[1]+=.13*Math.sin(Math.PI*t);
   const jersey=i%3?[.11,.18,.21]:[.82,.31,.12];
   stick(seat,neck,.145,jersey);
   if(fine&&rounded){
     rounded(mix(seat,neck,.62),[.15+.025*hike,.19-.044*hike,.15],jersey,14);
     rounded([neck[0],neck[1]+.083,neck[2]],[.09,.112,.091],skin);
     rounded([neck[0],neck[1]+.165,neck[2]],[.099,.052,.104],carbon);
   }else{
     stick(neck,[neck[0],neck[1]+.18,neck[2]],.088,skin);
     stick([neck[0],neck[1]+.16,neck[2]],[neck[0],neck[1]+.20,neck[2]],.10,carbon);
   }
   for(const arm of [-1,1]){
     const foot=mastCrew?[.36+arm*.13,1.09,.87+arm*.16]:[.74+arm*.14,.58,-1.09+arm*.08];
     const knee=mix([x+side*.28,1.02,z+arm*.10],[foot[0],mastCrew?1.49:.82,foot[2]+.17],t);
     const boot=mix([x+side*.38,.65,z+arm*.10],foot,t);
     knee[2]+=arm*.12*stride;boot[2]+=arm*.19*stride;boot[1]+=.12*Math.max(0,arm*stride);
     stick(seat,knee,.074);stick(knee,boot,.053);
     stick(boot,[boot[0],boot[1],boot[2]+.14],.059,carbon);
     const shoulder=mix([neck[0],neck[1]-.10,neck[2]+arm*.13],[neck[0]+arm*.14,neck[1]-.10,neck[2]],t);
     const grip=mastCrew?[hand[0],hand[1]+arm*.07,hand[2]]:arm>0?crank:[.61,1.08,-.62];
     let relaxed=[x+side*.16,1.16,z+arm*.12];
     if(helm && arm===1)relaxed=helmHand;
     if(runner)relaxed=arm===1?backstayGrip:[side*1.50,1.12,-5.62];
     const extended=[shoulder[0]+side*.59,shoulder[1]-.07,shoulder[2]+arm*.06];
     const palm=mix(mix(relaxed,extended,hike),grip,t);
     const elbow=mix(shoulder,palm,.52);
     elbow[0]+=.09*arm*t;elbow[2]-=.11*t;
     stick(shoulder,elbow,.054,jersey);stick(elbow,palm,.040,skin);
     stick(palm,[palm[0],palm[1]+.054,palm[2]],.043,carbon);
   }
 }
}
