"use strict";
// Nautor ClubSwan 36 brochure (2022), Under Sail, p. 14. The five published
// TWS/TWA/BS triples are anchors; all other entries are simulation estimates.
const swanAngles=[0,28,37,43,60,80,100,120,140,147,160,180];
const swanPolar=[
 [4, 0,0,2.7,3.5,4.4,4.7,4.6,4.3,3.8,3.5,3,2.4],
 [8, 0,0,5.5,6.9,7.6,8.6,8.7,8.3,7.3,7,6.3,5.2],
 [10,0,0,6.5,7.3,8.4,10.4,10.6,10.1,9.1,8.7,7.8,6.2],
 [14,0,0,7.7,8,10.3,18.4,16.5,14.4,12.4,11.9,10.3,8.2],
 [16,0,0,8,8.3,11.3,19,18.6,16.8,15,14.6,12.1,9.4],
 [20,0,0,8.1,8.6,12.3,19.7,21.8,22.5,21.5,21,16.2,11.5],
 [25,0,0,7.8,8.6,12.5,20,23,25,24,23.4,18.7,13.6]
];
function swanSpeed(wind,twa){
 const angle=Math.min(180,Math.abs(twa)), col=Math.max(1,swanAngles.findIndex(a=>a>=angle));
 const frac=(angle-swanAngles[col-1])/(swanAngles[col]-swanAngles[col-1]);
 const sample=row=>row[col]+frac*(row[col+1]-row[col]);
 if(wind<=4)return sample(swanPolar[0])*Math.max(0,wind)/4;
 const hi=swanPolar.findIndex(row=>row[0]>=wind);
 if(hi<0)return sample(swanPolar.at(-1));
 const a=swanPolar[hi-1],b=swanPolar[hi];
 return sample(a)+(sample(b)-sample(a))*(wind-a[0])/(b[0]-a[0]);
}
function updateSwanFoil(b,twa,knots,dt){
 const rotation=(55-15*spiRamp(8,16,knots))*(1-spiRamp(98,139,twa));
 const target=(b.lee||1)*rotation*Math.PI/180;
 b.foilRotation=(b.foilRotation||0)+(target-(b.foilRotation||0))*(1-Math.exp(-dt*.85));
 const flow=spiRamp(5,17,(b.waterSpeed||0)/.514444);
 b.foilLift=flow*(.11+.27*Math.abs(Math.sin(b.foilRotation)))*(.72+.28*spiRamp(.04,.36,Math.abs(b.heel)));
 b.foilSide=Math.sin(b.foilRotation)*flow;
}
function drawClubSwan(b,design,panel,hull,line,cloth,clock,metal,rounded){
 const fine=!b.i, carbon=[.083,.10,.115], shell=[.77,.83,.86],deck=[.84,.87,.85],
 sole=[.35,.40,.42],navy=[.085,.18,.26],blue=[.20,.52,.68],red=[.82,.26,.17],amber=[.91,.59,.19];
 const stick=(a,c,r=.015,color=carbon)=>line(a,c,r,color);
 const pad=(x,y,z,w,l,color)=>cloth([x-w,y,z-l],[x+w,y,z-l],[x+w,y,z+l],[x-w,y,z+l],color,.86,15);
 const mix=(a,c,t)=>a.map((x,i)=>x+(c[i]-x)*t);
 // Broad scow sections, hard aft chines, negative stem and recessed open cockpit.
 let prior;
 for(const [z,w,y,well] of design.sections){
   const row=side=>[[side*w,y,z],[side*w*.998,y-.14,z+.018],[side*w*.91,.10,z+.06],[side*w*.79,-.14,z+.09],[side*w*.43,-.35,z+.10],[0,-.41,z+.12]];
   for(const side of [-1,1]){
     const a=row(side),inner=[side*well,y,z],lower=[side*well,.42,z];
     if(prior){
       const old=prior.row(side),lip=[side*prior.well,prior.y,prior.z],floor=[lip[0],.42,prior.z];
       for(let i=1;i<a.length;i++)hull(old[i-1],a[i-1],a[i],old[i],i===1?navy:shell);
       cloth(old[0],a[0],inner,lip,deck,.84,1);
       panel(lip,inner,lower,floor,shell,.77);
       if(well||prior.well)cloth(lower,floor,[0,.42,prior.z],[0,.42,z],sole,.8,15);
     }else{
       panel(a[0],inner,lower,[a[0][0],.42,z],shell,.8);
       hull([0,.42,z],[a[0][0],.42,z],a[2],a[5],shell);
     }
   }
   prior={row,well,y,z};
 }
 const appendage=(root,tip,chord,angle=0)=>{
   const profile=(p,k,f)=>{
     const u=Math.PI*k/4,dx=.065*Math.sin(u)*f,dz=chord*Math.cos(u)*f;
     return [p[0]+dx*Math.cos(angle)+dz*Math.sin(angle),p[1],p[2]+dz*Math.cos(angle)-dx*Math.sin(angle)];
   };
   for(let i=0;i<8;i++)hull(profile(root,i,1),profile(root,i+1,1),profile(tip,i+1,.55),profile(tip,i,.55),carbon);
 };
 appendage([0,-.25,0],[0,-2.54,-.18],.46);
 // Wet surface clipping avoids drawing the bulb over the opaque sea.
 for(let i=0;i<8;i++){
   const bulb=(j,k)=>[.22*Math.sin(j*Math.PI/8)*Math.cos(k*Math.PI/4),-2.54+.21*Math.sin(j*Math.PI/8)*Math.sin(k*Math.PI/4),-.23+1.03*Math.cos(j*Math.PI/8)];
   for(let k=0;k<8;k++)hull(bulb(i,k),bulb(i+1,k),bulb(i+1,k+1),bulb(i,k+1),navy);
 }
 for(const s of [-1,1])appendage([s*1.02,.34,-4.65],[s*1.31,-1.38,-4.9],.32,b.rudderAngle||0);
 // Single curved board traversing the case: a signed rotation extends one end.
 const foilPoint=(a,k)=>{
   const u=Math.PI*k/4,r=2.02+.047*Math.sin(u);
   return [r*Math.sin(a),-1.07+r*Math.cos(a),.28+.245*Math.cos(u)];
 };
 for(let j=0;j<24;j++){
   const a=-1.64+j*3.28/24+(b.foilRotation||0),c=a+3.28/24;
   // The middle of the arc is enclosed by the foil case.
   if(Math.abs(Math.sin((a+c)/2))*2.02<1.66)continue;
   for(let k=0;k<8;k++)hull(foilPoint(a,k),foilPoint(a,k+1),foilPoint(c,k+1),foilPoint(c,k),carbon);
 }
 function winch(x,y,z,color){
   const at=(a,h,r)=>[x+r*Math.cos(a),y+h,z+r*Math.sin(a)];
   const rings=[[0,.135],[.035,.137],[.075,.091],[.17,.087],[.195,.118],[.22,.114]];
   const steps=fine?12:6;
   for(let i=1;i<rings.length;i++)for(let k=0;k<steps;k++){
     const a=2*Math.PI*k/steps,c=a+2*Math.PI/steps;
     panel(at(a,...rings[i-1]),at(c,...rings[i-1]),at(c,...rings[i]),at(a,...rings[i]),i===4?metal:carbon,.88);
   }
   stick([x,y+.20,z],[x,y+.219,z],.107,carbon);
   if(fine){
     let prev=at(0,.083,.094);
     for(let k=1;k<=22;k++){const next=at(k*.55,.083+.003*k,.094);stick(prev,next,.008,color);prev=next;}
     stick(prev,[x*.84,y+.08,z+.40],.013,color);
     const phase=x===0?(b.halyardPhase||0):.45;
     stick([x,y+.22,z],[x+.14*Math.cos(phase),y+.25,z+.14*Math.sin(phase)],.018,metal);
   }
 }
 const mast=[0,17.55,.46],foot=[0,1.05,.62],tack=[0,.92,5.39],lift=b.spiHoist||0;
 const sprit=[0,.91,5.49+2.49*lift];
 stick(foot,mast,.088);stick(tack,sprit,.069);stick([0,14.08,.53],tack,.012);
 stick(foot,[.005,10,.56],.095);
 pad(.05,.961,3.35,.17,1.59,sole);pad(-.60,.976,2.15,.37,.42,carbon);
 pad(-.60,.981,2.15,.32,.37,sole);pad(0,.969,-.07,.27,.63,sole);
 if(fine)stick([-.74,.992,1.87],[-.49,.992,1.87],.015,metal);
 for(const s of [-1,1]){
   winch(s*1.47,.86,-4.22,red);winch(s*1.55,.91,-2.87,blue);winch(s*1.44,.93,-1.48,amber);
   stick(mast,[s*1.46,.90,-4.93],.012);
   stick([s*1.46,.90,-4.93],[s*1.47,1.02,-4.22],.018,red);
   let prev=[s*1.62,.92,.33];
   for(const [h,w] of [[6.7,1.31],[11.8,.88]]){
     const arm=[s*w,h,.14];stick([0,h,.56],arm,.035);stick(prev,arm,.012);prev=arm;
   }
   stick(prev,mast,.011);
   let rail;
   for(const [z,w,y] of design.stations.filter(row=>row[1]>.4)){
     const top=[s*w*.99,y+.49,z];
     stick([top[0],y,z],top,.012,metal);
     if(rail)stick(rail,top,.009,metal);
     rail=top;
   }
   for(const z of [-3.48,-2.52,-1.72]){
     stick([s*.83,.46,z-.22],[s*.83,.54,z+.24],.047,sole);
   }
   if(fine){
     for(let j=0;j<3;j++){
       const x=s*(.58+.10*j);
       stick([x,.98,-.4],[x,1.002,-.21],.029,carbon);
       stick([x,1.009,-.23],[s*(1.09+.10*j),.96,-.78],.009,[red,blue,amber][j]);
     }
   }
 }
 winch(0,.98,-.65,amber);
 if(fine){
   // Sliding companionway, recessed retrieval hatch and instrument repeaters.
   panel([-.43,.46,-.91],[.43,.46,-.91],[.40,.94,-.77],[-.40,.94,-.77],carbon,.8);
   pad(0,.976,-.02,.42,.24,navy);
   for(const sign of [-1,1]){
     stick([sign*.43,.98,-.55],[sign*.43,.98,.44],.018,metal);
     stick([sign*.15,1.01,.45],[sign*.15,1.065,.81],.013,amber);
     stick([sign*1.47,.94,-4.89],[sign*1.52,1.04,-4.67],.033,carbon);
   }
   for(let j=0;j<3;j++){
     const y=1.24+j*.154;
     panel([-.145,y,.50],[.145,y,.50],[.145,y+.134,.50],[-.145,y+.134,.50],carbon,.9);
     panel([-.114,y+.025,.491],[.114,y+.025,.491],[.114,y+.107,.491],[-.114,y+.107,.491],[.58,.69,.57],.94);
   }
   stick([-.85,.998,2.04],[-.43,.998,2.32],.011,red);
   stick([0,1.13,.60],[0,1.10,-.65],.014,amber);
 }
 const tiller=b.rudderAngle||0,handle=[Math.sin(tiller)*1.38,.90,-4.96+Math.cos(tiller)*1.38];
 stick([0,.52,-4.96],handle,.051);
 const crewAcross=Math.max(-1,Math.min(1,(b.crewOffset||0)/.32)),helmHand=[crewAcross*.78,1.13,-3.87];
 stick(handle,helmHand,.018);
 const ma=b.mainSail.angle||0,ja=b.jibSail.angle||0,heavy=b.jibNumber===2;
 function membrane(v,u,main){
   const chord=main?(5.80*(1-v)+1.45*v+.62*Math.sin(v*Math.PI)):(heavy?4.34:5.09)*(1-v);
   const a=(main?ma:ja)*(1+.18*v),d=u*chord;
   const bulge=sotoMembrane(main?b.mainSail:b.jibSail,a,v,u,chord,clock,main);
   return [Math.sin(a)*d+Math.cos(a)*bulge,main?2.49+15*v:1.01+(heavy?12.1:13.11)*v+.37*u*(1-v),
    (main?.62-.16*v:5.39-4.77*v*(heavy?.92:1))-Math.cos(a)*d+Math.sin(a)*bulge];
 }
 function skin(point,color,kind){
   const n=fine?22:6,m=fine?13:4;
   let prev;
   for(let i=0;i<=n;i++){
     const row=Array.from({length:m+1},(_,j)=>[...point(i/n,j/m),j/m,i/n]);
     if(prev)for(let j=1;j<=m;j++)cloth(prev[j-1],prev[j],row[j],row[j-1],color,.85,kind);
     prev=row;
   }
 }
 const main=(v,u)=>membrane(v,u,true),jib=(v,u)=>membrane(v,u,false);
 skin(main,[.25,.29,.31],19);skin(jib,[.36,.40,.42],16);
 stick(main(0,0),main(0,1),.083);
 stick(foot,main(0,.29),.035,metal);
 stick([-1.08,.47,-3.10],[1.08,.47,-3.10],.031,metal);
 for(const d of [-.03,.03])stick([Math.sin(ma)*.72+d,.51,-3.10],main(0,.76),.014,blue);
 const lee=b.lee||1;
 stick(jib(0,1),[lee*1.14,1.00,-.09],.016,amber);
 stick([lee*1.14,1,-.09],[lee*1.44,1.08,-1.48],.015,amber);
 if(fine){
   for(const v of [.24,.48,.70,.88]){
     let p=main(v,.55);
     for(const u of [.70,.85,1]){const q=main(v,u);stick(p,q,.014,[.43,.47,.46]);p=q;}
     const end=jib(v,.22);stick(end,[end[0]+.07*Math.sin(clock*7+v),end[1]-.055,end[2]-.16],.01,red);
   }
 }
 if(lift>.01){
   const kite=drawFlyingSpi(b,sprit,[mast[0],sprit[1]+16.47,mast[2]],5.6,7.5,clock,[.93,.40,.23],cloth);
   stick(kite(1,0),mast,.012,amber);
   drawSpiSheets(b,kite(0,1),sprit,1.43,.93,-4.85,stick,red);
 }
 const effort=b.extraHike||0, aft=spiRamp(7,17,(b.waterSpeed||0)/.514444)*.54;
 for(let i=0;i<6;i++){
   const helm=i===0,travel=i>=4?spiRamp(0,1,b.halyardCrew||0):0;
   const z=helm?-4.07:-3.38+.82*(i-1)-aft;
   const x=crewAcross*(helm?.91:1.53);
   if(i===3 && drawSheetRunner(b,[x,.93,z],[1.43,.93,-4.85],stick,red,navy))continue;
   const station=i===5?[.23,1.42,.59]:[.17,.94,-.93];
   const seat=mix([x,.93,z],station,travel);
   const lean=helm?.10:crewAcross*(.13+.37*effort);
   const neck=mix([x+lean,1.52-.20*Math.abs(lean),z+.05],[station[0],station[1]+.42,station[2]+.12],travel);
   const jersey=i%2?navy:[.69,.75,.77],flesh=[.72,.52,.39];
   stick(seat,neck,.146,jersey);
   if(fine){rounded(neck.map((v,k)=>v+(k===1?.10:0)),[.092,.116,.09],flesh);rounded([neck[0],neck[1]+.18,neck[2]],[.10,.06,.105],navy);}
   else stick(neck,[neck[0],neck[1]+.2,neck[2]],.092,flesh);
   for(const s of [-1,1]){
     const knee=[seat[0]+crewAcross*(helm?-.21:.25)*(1-travel),seat[1]-.035,seat[2]+.12*s];
     const boot=[knee[0]+crewAcross*.08*(1-travel),knee[1]-.39,knee[2]+.08];
     stick(seat,knee,.072,navy);stick(knee,boot,.054,carbon);
     const shoulder=[neck[0],neck[1]-.12,neck[2]+s*.14];
     const hand=helm&&s===1?helmHand:mix([x+crewAcross*.13,1.16,z+s*.11],
       i===5?[.09,1.9+.18*Math.sin(b.halyardPhase||0)+s*.09,.58]:[.10*s,1.21,-.65],travel);
     const elbow=mix(shoulder,hand,.49);elbow[1]-=.09;
     stick(shoulder,elbow,.05,jersey);stick(elbow,hand,.038,flesh);
   }
 }
}
