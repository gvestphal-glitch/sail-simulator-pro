"use strict";
// King TP 52 published speed targets, knots. VMG is converted to boat speed.
const tp52Winds=[4,6,8,10,12,14,16,20,24];
const tp52Rows=[
 [52,5.54,7.75,8.89,9.40,9.70,9.96,10.19,10.52,10.55],
 [60,6.02,8.22,9.27,9.82,10.16,10.48,10.74,11.13,11.23],
 [75,6.46,8.60,9.61,10.43,10.89,11.27,11.64,12.21,12.54],
 [90,6.34,8.49,9.54,10.53,11.37,11.95,12.49,13.42,14.08],
 [110,5.70,7.96,9.43,10.40,11.19,12.02,13.06,14.77,16.06],
 [120,5.38,7.71,9.30,10.46,11.45,12.41,13.25,14.93,16.68],
 [135,4.75,6.92,8.78,9.96,11.21,12.61,13.89,16.11,18.39],
 [150,3.95,5.77,7.43,8.73,9.77,10.92,12.30,15.41,19.17]
];
const tp52Curves=tp52Winds.map((w,i)=>{
 const beat=[46,43.6,40.8,39.1,38.2,37.5,36.9,36.7,37.6][i];
 const run=[139.7,140.6,141.4,146.4,148.2,145.6,144.5,145.8,148.9][i];
 const up=[3.52,5.05,6.02,6.49,6.79,6.97,7.13,7.27,7.22][i];
 const down=[3.42,5.01,6.45,7.56,8.45,9.43,10.61,13.33,16.60][i];
 return [[0,0],[beat-12,0],[beat,up/Math.cos(beat*Math.PI/180)],...tp52Rows.map(r=>[r[0],r[i+1]]),
   [run,-down/Math.cos(run*Math.PI/180)],[180,.90*down]].sort((a,b)=>a[0]-b[0]);
});
function tp52Speed(w,a){
 const speed=curve=>{
   const j=curve.findIndex(p=>p[0]>=Math.abs(a));
   if(j<0)return curve.at(-1)[1];
   if(!j)return 0;
   const [x,y]=curve[j-1],[xx,yy]=curve[j];
   return y+(yy-y)*(Math.abs(a)-x)/(xx-x);
 };
 if(w<4)return Math.max(0,w)/4*speed(tp52Curves[0]);
 const i=tp52Winds.findIndex(v=>v>w);
 if(i<0)return speed(tp52Curves.at(-1));
 const lo=speed(tp52Curves[i-1]);
 return lo+(speed(tp52Curves[i])-lo)*(w-tp52Winds[i-1])/(tp52Winds[i]-tp52Winds[i-1]);
}
function drawTP52(b,design,panel,hull,line,cloth,t,metal,rounded){
 const blue=[.09,.22,.33],deck=[.55,.58,.58],carbon=[.095,.11,.12],red=[.78,.20,.14],skin=[.69,.47,.34];
 const rod=(a,c,r=.022,color=carbon)=>line(a,c,r,color);
 // Anafesto's broad open stern drains through the transom. The cockpit sole
 // rises towards the pit; the underwater run lifts towards both ends.
 const sole=z=>.62+.018*(z+7.925);
 let prev;
 for(const [z,w,y,opening] of design.sections){
   const aft=Math.max(0,-z/7.925),bow=Math.max(0,z/7.925);
   const keel=-.58+.85*aft*aft+.54*bow**3;
   const row=s=>[[s*w,y,z],[s*w*.975,.46+.10*aft,z],[s*w*(.86+.075*aft),keel+.35,z],
     [s*w*.62,keel+.12,z],[0,keel,z]];
   const sides=[row(-1),row(1)];
   for(let k=0;k<2;k++){
     const s=k*2-1,r=sides[k],inner=[s*opening,y,z],floor=[s*opening,sole(z),z];
     if(prev){
       const old=prev[k],lastZ=old[0][2];
       for(let j=1;j<5;j++)hull(old[j-1],r[j-1],r[j],old[j],blue);
       cloth(old[0],r[0],inner,old[5],deck,.8,1);
       if(opening||old[5][0]){
         panel(old[5],inner,floor,old[6],deck,.8);
         cloth(old[6],floor,[0,sole(z),z],[0,sole(lastZ),lastZ],deck,.8,15);
       }
       // Painted perimeter stripe follows the sheer, including the fine bow.
       const stripe=(v,k)=>[v[0]*k,v[1]+.009,v[2]];
       panel(stripe(old[0],.965),stripe(r[0],.965),stripe(r[0],.935),stripe(old[0],.935),red,.45);
     }
     if(!prev){
       // Close only the side cheeks and the narrow transom below the sole.
       panel(r[0],inner,floor,[r[1][0],sole(z),z],deck,.7);
       hull([0,sole(z),z],[r[1][0],sole(z),z],r[1],[0,r[1][1],z],blue);
       for(let j=2;j<5;j++)hull([0,r[j-1][1],z],r[j-1],r[j],[0,r[j][1],z],blue);
     }
     r.push(inner,floor);
   }
   prev=sides;
 }
 const head=[0,23.3,.68],mast=[0,1.18,.78],tack=[0,1.26,7.82],sprit=[0,1.28,9.9];
 rod(mast,head,.117);rod(tack,head,.024);rod(tack,sprit,.10);
 for(const s of [-1,1]){
   let stay=[s*2,1.16,.12];
   for(const [h,reach] of [[8.55,1.81],[16.25,1.13]]){
     const tip=[s*reach,h,.43];rod([0,h,.76],tip,.047);rod(stay,tip,.021);stay=tip;
   }
   rod(stay,head,.02);rod(head,[s*1.69,1.17,-7.35],.021);
 }
 function blade(root,tip,chord,rotation){
   const section=(p,c)=>[[-.07,.15],[0,.38],[.07,.15],[0,-.62]].map(([x,z])=>
     [p[0]+c*(x*Math.cos(rotation)+z*Math.sin(rotation)),p[1],p[2]+c*(z*Math.cos(rotation)-x*Math.sin(rotation))]);
   const upper=section(root,chord),lower=section(tip,chord*.55);
   for(let j=0;j<4;j++)panel(upper[j],upper[(j+1)%4],lower[(j+1)%4],lower[j],carbon,.8);
 }
 blade([0,-.35,-.28],[0,-3.36,-.35],1.18,0);
 blade([0,.2,-6.4],[0,-2.04,-6.78],.79,b.rudderAngle||0);
 rounded([0,-3.32,-.34],[.26,.18,1.45],carbon);
 const sail=(main,v,u)=>{
   const sheet=main?b.mainSail:b.jibSail,angle=(sheet.angle||0)*(1+.14*v);
   const jib=b.jibNumber||1,span=main?8.05:6.7-.47*(jib-1);
   const chord=span*(main?1-.76*v-.09*v*v:1-v);
   const belly=sotoMembrane(sheet,angle,v,u,chord,t,main);
   const height=main?2.23+21.07*v:1.28+(20.2-(jib-1)*1.05)*v;
   return [u*chord*Math.sin(angle)+belly*Math.cos(angle),height+.25*u*(1-v),
     (main?.78-.10*v:7.82-6.75*v)-u*chord*Math.cos(angle)+belly*Math.sin(angle),u,v];
 };
 for(const main of [true,false]){
   const rows=b.i?6:23,cols=b.i?4:13;
   const sheet=main?b.mainSail:b.jibSail;
   const membrane=(main?20:21)+.49*Math.min(1,Math.max(0,sheet.flutter||0));
   let lower;
   for(let i=0;i<=rows;i++){
     const upper=Array.from({length:cols+1},(_,j)=>sail(main,i/rows,j/cols));
     if(lower)for(let j=0;j<cols;j++)cloth(lower[j],lower[j+1],upper[j+1],upper[j],main?[.27,.29,.29]:[.34,.36,.34],.75,membrane);
     lower=upper;
   }
 }
 rod(sail(true,0,0),sail(true,0,1),.105);
 rod([-1.44,.77,-4.72],[1.44,.77,-4.72],.05,metal);
 rod(sail(true,0,.70),[(b.lee||1)*.34,.78,-4.72],.027,red);
 rod(mast,sail(true,0,.36),.045,metal);
 const lee=b.lee||1;
 rod(sail(false,0,1),[lee*1.66,1.21,-.65],.025,red);
 if(b.spiHoist>.01){
   const kite=drawFlyingSpi(b,sprit,head,7.1,10.8,t,[.87,.35,.14],cloth);
   drawSpiSheets(b,kite(0,1),sprit,1.9,1.18,-6.8,rod,red);
 }
 const rail=Math.max(-1,Math.min(1,(b.crewOffset||0)/.32));
 const grind=b.grindPhase||0;
 function sailor(hip,neck,hands,feet,jersey){
   rod(hip,neck,.145,jersey);rounded([neck[0],neck[1]+.115,neck[2]],[.094,.118,.094],skin);
   for(let k=0;k<2;k++){
     const s=k*2-1,hand=hands[k],boot=feet[k];
     const knee=[(hip[0]+boot[0])*.5,(hip[1]+boot[1])*.5,boot[2]+.15];
     const shoulder=[neck[0]+s*.12,neck[1]-.09,neck[2]];
     const elbow=shoulder.map((v,i)=>(v+hand[i])*.5+(i===1?-.10:0));
     rod(shoulder,elbow,.06,jersey);rod(elbow,hand,.043,skin);
     rod(hip,knee,.082);rod(knee,boot,.058);
   }
 }
 const gray=[.32,.35,.35],rubber=[.053,.064,.066],silver=[.64,.66,.64];
 const teal=[.11,.48,.49],gold=[.85,.69,.32];
 // Closed tapered housing used for pedestal bodies, plinths and hatch frames.
 function housing(x,z,y,w,d,rise,topW,topD,color){
   const ring=(h,a,c)=>[[-a,-c],[a,-c],[a,c],[-a,c]].map(([i,j])=>[x+i,h,z+j]);
   const lower=ring(y,w,d),upper=ring(y+rise,topW,topD);
   for(let i=0;i<4;i++){const j=(i+1)%4;panel(lower[i],lower[j],upper[j],upper[i],color,.75);}
   panel(...upper,color,.75);
 }
 function hatch(x,z,y,w,d){
   housing(x,z,y,w,d,.038,w-.015,d-.015,silver);
   housing(x,z,y+.038,w-.04,d-.04,.012,w-.04,d-.04,rubber);
   rod([x-.10,y+.062,z+d*.54],[x+.10,y+.062,z+d*.54],.015,metal);
 }
 hatch(0,3.78,1.24,.48,.70);
 housing(0,-.32,1.17,.70,.49,.16,.53,.42,deck);
 hatch(0,-.38,1.33,.49,.34);
 for(const s of [-1,1]){
   const path=[[.63,1.25,4.62],[.73,1.23,2.85],[1.35,1.20,.35],[1.55,1.17,-1.1]];
   for(let i=1;i<path.length;i++){
     const edge=(q,k)=>[s*(q[0]+k),q[1]+.014,q[2]];
     panel(edge(path[i-1],0),edge(path[i],0),edge(path[i],.055),edge(path[i-1],.055),red,.5);
   }
   let last;
   for(const [w,y,z] of [[1.79,1.04,-7.75],[1.99,1.07,-6.1],[2.13,1.11,-3.7],[2.07,1.15,-1.1],[1.83,1.20,1.6],[1.37,1.23,4.15],[.68,1.26,6.55],[.12,1.27,7.80]]){
     const foot=[s*w,y,z],top=[s*w,y+.55,z],mid=[s*w,y+.28,z];
     rod(foot,top,.015,metal);
     if(last){rod(last.top,top,.009,silver);rod(last.mid,mid,.008,silver);}
     last={top,mid};
   }
 }
 // Eight winches in four pairs. A waisted drum, upper flange and separate
 // socket remain legible from the stern camera. Only the player gets rope wraps.
 function winch(x,y,z,r,rope){
   const n=b.i?8:12;
   const vertex=(radius,height,a)=>[x+radius*Math.cos(a),y+height,z+radius*Math.sin(a)];
   const rings=[[1.12,0],[1.12,.22],[.78,.48],[.72,1.29],[.96,1.50],[.94,1.69],[.27,1.69],[.27,1.54]];
   for(let i=0;i<n;i++){
     const a=i*2*Math.PI/n,c=(i+1)*2*Math.PI/n;
     for(let k=1;k<rings.length;k++){
       const [ra,ha]=rings[k-1],[rb,hb]=rings[k];
       panel(vertex(r*ra,r*ha,a),vertex(r*ra,r*ha,c),vertex(r*rb,r*hb,c),vertex(r*rb,r*hb,a),
         k===4||k===6?silver:k===3?gray:carbon,.9);
     }
     if(!b.i)for(let turn=0;turn<3;turn++){
       const h=r*(.50+.21*(turn+i/n)),h2=h+.21*r/n;
       panel(vertex(.79*r,h,a),vertex(.79*r,h2,c),vertex(.79*r,h2+.13*r,c),vertex(.79*r,h+.13*r,a),rope,.7);
     }
   }
 }
 for(const s of [-1,1]){
   for(const [x,y,z,r,c] of [[1.71,1.10,-3.12,.205,red],[1.70,1.06,-6.95,.18,gold],
     [1.63,1.085,-4.92,.16,teal],[.80,1.18,-.50,.137,silver]]){
     housing(s*x,z,y-.04,r*1.36,r*1.48,.07,r*1.20,r*1.18,gray);
     winch(s*x,y+.03,z,r,c);
   }
   rod([s*1.66,1.21,-.65],[s*1.86,1.28,-3.12],.022,red);
   rod([s*1.69,1.17,-7.35],[s*1.86,1.20,-6.95],.023,gold);
   rod([s*.19,1.24,.73],[s*.83,1.29,-.50],.018,silver);
   rod([lee*.34,.81,-4.72],[s*1.76,1.22,-4.92],.021,teal);
 }
 // Port and starboard crank grips rotate in opposition on a common axle.
 for(const z of [-2.12,-5.94]){
   const floor=sole(z),cy=floor+.88,cx=z< -5?.56:0;
   housing(cx,z,floor,.23,.27,.09,.19,.22,gray);
   housing(cx,z,floor+.09,.16,.19,.66,.095,.13,carbon);
   housing(cx,z,cy-.13,.12,.14,.23,.12,.10,red);
   rod([cx-.20,cy,z],[cx+.20,cy,z],.056,metal);
   const hands=[-1,1].map(s=>{
     const crank=[cx+s*.18,cy+s*.195*Math.sin(grind),z+s*.195*Math.cos(grind)];
     const grip=[cx+s*.34,crank[1],crank[2]];
     rod([cx+s*.18,cy,z],crank,.036,silver);rod(crank,grip,.035,rubber);
     return [cx+s*.28,crank[1],crank[2]];
   });
   sailor([cx,floor+.70,z-.52],[cx,cy+.26,z-.28],hands,[[cx-.23,floor+.04,z-.68],[cx+.23,floor+.04,z-.39]],blue);
 }
 const side=Math.sign(rail)||1;
 const tiller=b.rudderAngle||0,helmX=rail*1.26;
 const tip=[1.46*Math.sin(tiller),1.17,-6.40+1.46*Math.cos(tiller)];
 const helmGrip=[helmX*.84,1.42,-5.16];
 rod([0,sole(-6.40),-6.40],[0,1.07,-6.40],.09,metal);
 rod([0,1.07,-6.40],tip,.050,carbon);rod(tip,helmGrip,.024,metal);
 // Helm on the tiller extension, runner aft, pit and mast on the hoist, rail crew forward.
 for(let i=0;i<10;i++){
   const helm=i===0,runner=i===1,mastCrew=i===9,pit=i===8;
   const z=helm?-5.52:runner?-7.03:-4.2+(i-2)*.98;
   const h=(pit||mastCrew)?spiRamp(0,1,b.halyardCrew||0):0;
   const railWidth=z>1?1.82-.18*(z-1):1.82;
   const x=rail*(helm?1.26:railWidth)*(1-h)+h*(mastCrew?.24:.55);
   const cz=z*(1-h)+h*(mastCrew?.78:-.62);
   if(i===6&&drawSheetRunner(b,[x,1.12,z],[1.90,1.18,-6.8],rod,red,blue))continue;
   const lean=helm||runner?0:rail*(b.extraHike||0)*.55*(1-h);
   const hip=[x,helm?1.42:1.13,cz],neck=[x+lean,hip[1]+.53-.30*Math.abs(lean),cz+.09];
   const hands=[-1,1].map(s=>helm?[helmGrip[0]+s*.055,helmGrip[1],helmGrip[2]]:runner?[side*1.72+s*.09,1.42,-6.95]:
     [neck[0]+s*.11+lean*.60,neck[1]-.24+h*.15*Math.sin(b.halyardPhase||0),cz+.29]);
   sailor(hip,neck,hands,[-1,1].map(s=>[x+.10*s+rail*.17*(1-h),hip[1]-.47,cz+s*.14]),i%3?blue:red);
 }
}
