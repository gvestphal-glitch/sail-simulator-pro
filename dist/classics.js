"use strict";
// LOA, LWL, beam, draft and original masthead rig dimensions in metres.
// Sections and hardware arrangements are reconstructions, not builder offsets.
const classicDesigns={
 columbia50:{name:"Columbia 50",length:15.24,lwl:10.13,beam:3.67,draft:1.99,I:16.79,J:5.52,P:14.78,E:6.04,
   deck:1.24,crew:7,wheel:true,house:[-.255,-.055,.275,.58],windows:1,bilge:.78,sheer:[.16,.08,.025,0,0,.04,.14,.22,.33],keel:[-.17,.115,-.15,.029],
   widths:[.34,.57,.79,.91,1,.92,.65,.31,.012],sternWL:-4.92,rocker:.86,hullKn:7.73,inertia:9,turn:.36,area:90.95},
 arpege30:{name:"Dufour Arpège 30",length:9.14,lwl:6.71,beam:3.02,draft:1.40,I:11.40,J:3.23,P:9.51,E:3.60,
   deck:.88,crew:4,skeg:true,house:[-.225,.265,.33,.43],windows:1,bilge:.85,sheer:[.04,.02,0,0,.01,.025,.07,.10,.13],keel:[-.14,.115,-.125,.055],
   widths:[.58,.74,.91,.98,1,.88,.58,.25,.012],sternWL:-3.30,rocker:.50,hullKn:6.29,inertia:4.5,turn:.55,area:35.49},
 cal40:{name:"Cal 40",length:11.99,lwl:9.24,beam:3.35,draft:1.70,I:14.02,J:4.62,P:12.19,E:5.33,
   deck:.97,crew:6,house:[-.175,.245,.32,.406],windows:5,bilge:.92,sheer:[.09,.04,.01,0,0,.025,.08,.13,.19],keel:[-.13,.12,-.105,.028],
   widths:[.43,.63,.84,.95,1,.94,.72,.37,.012],sternWL:-4.57,rocker:.56,hullKn:7.38,inertia:5.6,turn:.51,area:65.03}
};
for(const d of Object.values(classicDesigns)){
 const L=d.length,B=d.beam/2,fore=d.sternWL+d.lwl;
 d.bow=.475*L;d.mast=d.bow-d.J;d.tackY=d.deck+.31;d.top=d.tackY+d.I;
 const zs=[-L/2,d.sternWL,-.29*L,-.17*L,0,.19*L,fore,(fore+L/2)/2,L/2];
 d.stations=zs.map((z,i)=>[z,B*d.widths[i],d.deck+d.sheer[i],
   [.66,0,-.65,-.91,-1,-.82,0,.46,1][i]*(i===8?d.deck+d.sheer[i]-.015:d.rocker),0]);
 // Insert abrupt cockpit ends separately from the fair hull stations.
 for(const [at,opening] of [[-.395,0],[-.386,.18],[-.30,.21],[d.house[0]-.012,.22],[d.house[0]-.004,0]]){
   const z=at*L,idx=d.stations.findIndex(r=>r[0]>=z),a=d.stations[idx-1],b=d.stations[idx];
   const t=(z-a[0])/(b[0]-a[0]);
   d.stations.splice(idx,0,[z,...[1,2,3].map(k=>a[k]+(b[k]-a[k])*t),opening*d.beam]);
 }
 // Fair the Columbia quarters independently of cockpit cutout stations.
 if(d.wheel)for(const r of d.stations){
   if(r[0]<=0){
     const u=1+2*r[0]/L;
     r[1]=B*(.34+.66*Math.sin(u*Math.PI/2));
   }
 }
 for(const r of d.stations)if(r[0]>-.38*L&&r[0]<(d.house[0]-.011)*L&&!r[4])r[4]=.21*d.beam;
}
function drawVintageSloop(b,d,panel,hull,rod,cloth,time,metal,rounded){
 const L=d.length,B=d.beam,D=d.deck,white=[.93,.92,.86],wood=[.48,.29,.16],glass=[.11,.20,.24],line=[.78,.75,.62];
 wood.varnish=true;
 const sole=(a,c,e,f)=>cloth(a,c,e,f,[.66,.50,.33],.82,1.30);
 drawClassicShell(d,panel,hull,rod,sole,wood,white,[.065,.065,.068]);
 // Foils have closed root and tip sections and a rounded leading edge.
 function foil(root,tip,angle){
   const ring=([z,y,chord,thick])=>[[.16,1],[.76,.63],[1,.07],[1,-.07],[.76,-.63],[.16,-1],[0,0]].map(([aft,side])=>{
     const x=side*thick,arm=-aft*chord;
     return [x*Math.cos(angle)+arm*Math.sin(angle),y,z+arm*Math.cos(angle)-x*Math.sin(angle)];
   });
   const a=ring(root),c=ring(tip);
   for(let i=0;i<a.length;i++){
     const j=(i+1)%a.length;panel(a[i],a[j],c[j],c[i],brasilBottom,.83);
     if(i>0&&j)panel(c[0],c[i],c[j],c[j],brasilBottom,.83);
   }
 }
 const [keelAft,fore,baseAft,baseFore]=d.keel;
 foil([fore*L,-.25,(fore-keelAft)*L,B*.068],[baseFore*L,-d.draft,(baseFore-baseAft)*L,B*(d.skeg?.068:.031)],0);
 const stock=-.31*L;
 if(d.skeg)foil([stock+.44,-.16,.48,.073],[stock+.14,-d.draft*.79,.19,.045],0);
 foil([stock,-.10,.071*L,.056],[stock-.017*L,-d.draft*.86,.041*L,.030],b.rudderAngle||0);
 const [start,end,half,rise]=d.house;
 function cabin(z,t){
   const w=B*half*(1-.24*t*t),top=D+rise*(d.skeg?1-.58*Math.min(1,Math.max(0,(t-.35)/.27)):d.wheel?1-.66*t**4:1-.24*t*t);
   return [[-w,D,z],[-w*.96,top-.085,z],[-w*.71,top,z],[0,top+.038,z],[w*.71,top,z],[w*.96,top-.085,z],[w,D,z]];
 }
 let prev;
 const continuous=d.windows===1;
 const from=.07,to=d.skeg?.51:.76;
 const stops=Array.from({length:9},(_,i)=>i/8);
 if(continuous)stops.push(from,from+.025,to-.035,to);
 stops.sort((a,b)=>a-b);
 let lastT=0;
 for(const t of stops){
   const z=L*(start+(end-start)*t),r=cabin(z,t);
   if(prev)for(let k=1;k<7;k++){
     if(continuous && (k===1||k===6) && lastT>=from && t<=to){
       // The pane replaces the cabin side between its sill and header.
       const strips=(row,at)=>{
         const foot=row[k===1?0:6],cap=row[k===1?1:5];
         const upper=.51+.35*Math.min(1,(at-from)/.025,(to-at)/.035);
         return [0,.22,upper,1].map(h=>foot.map((n,i)=>n+h*(cap[i]-n)));
       };
       const a=strips(prev,lastT),c=strips(r,t);
       for(let n=1;n<4;n++)panel(a[n-1],c[n-1],c[n],a[n],n===2?glass:white,.82);
     }else panel(prev[k-1],r[k-1],r[k],prev[k],white,.84);
   }
   if(t===0||t===1)for(let k=1;k<=3;k++)panel(r[k-1],r[k],r[6-k],r[7-k],white,.8);
   lastT=t;
   prev=r;
 }
 for(const side of [-1,1]){
   const windowAt=(t,h)=>{
     const z=L*(start+(end-start)*t),r=cabin(z,t),x=Math.abs(r[0][0])*(1-.04*h)+.012;
     return [side*x,D+(r[1][1]-D)*h,z];
   };
   for(let j=0;!continuous&&j<d.windows;j++){
     const t=.07+j*(.84/d.windows),w=d.skeg?.44:.69/d.windows;
     if(!d.skeg&&!d.wheel&&j>=2){
       const center=t+.05;
       const rim=i=>windowAt(center+.021*Math.cos(i*Math.PI/6),.54+.18*Math.sin(i*Math.PI/6));
       for(let i=0;i<12;i++)panel(windowAt(center,.54),rim(i),rim(i+1),windowAt(center,.54),glass,.76);
       continue;
     }
     panel(windowAt(t,.25),windowAt(t+.018,.86),windowAt(t+w,.86),windowAt(t+w-.01,.25),glass,.7);
   }
   rod([side*B*half*.63,D+rise+.067,start*L+.22],[side*B*half*.56,D+rise*.78+.065,end*L-.27],.025,wood);
   // Cockpit seat and raised coaming extend to the aft cabin bulkhead.
   const x=side*B*.258,za=-.377*L,zf=(start-.016)*L;
   panel([side*B*.21,D+.047,za],[x,D+.047,za],[x,D+.047,zf],[side*B*.21,D+.047,zf],d.skeg?wood:white,.84);
   panel([x,D+.04,za],[x,D+.12,za],[x,D+.22,zf],[x,D+.04,zf],wood,.86);
   // Each genoa sheet runs from its car to the primary winch.
   const car=[side*B*.36,D+.07,start*L+.34];
   rod([car[0],D+.055,car[2]-.31],[car[0],D+.055,car[2]+.37],.022,metal);
   rod(car,[side*B*.31,D+.17,-.24*L],.014,line);
   let last;
   for(const i of [1,3,5,7,9,11,d.stations.length-1]){
     const [z,w,y]=d.stations[i],stanchion=[side*w*.97,y+.52,z];
     rod([side*w*.97,y,z],stanchion,.016,metal);
     if(last)rod(last,stanchion,.008,metal);last=stanchion;
   }
   for(const t of [-.32,-.24]){
     const x=side*.31*B,z=t*L;
     rod([x,D+.03,z],[x,D+.17,z],.074,metal);rod([x,D+.16,z],[x,D+.19,z],.09,metal);
     for(let k=0;k<3;k++)rod([x,D+.065+.023*k,z],[x,D+.077+.023*k,z],.082,line);
   }
 }
 const rect=(w,y,z,h,c)=>panel([-w,y,z-h],[w,y,z-h],[w,y,z+h],[-w,y,z+h],c,.85);
 const hatch=(z,y,w,h)=>{
   const lip=y+.052;
   for(const sign of [-1,1]){
     panel([sign*w,y,z-h],[sign*w,lip,z-h],[sign*w,lip,z+h],[sign*w,y,z+h],wood,.82);
     panel([-w,y,z+sign*h],[w,y,z+sign*h],[w,lip,z+sign*h],[-w,lip,z+sign*h],wood,.82);
   }
   rect(w,lip,z,h,wood);rect(w-.045,lip+.006,z,h-.045,glass);
 };
 hatch((start+.05)*L,D+rise+.036,.37,.37);
 const hatchZ=(end+.075)*L;
 const hi=d.stations.findIndex(row=>row[0]>=hatchZ),lo=d.stations[hi-1],next=d.stations[hi];
 const foreDeck=lo[2]+(next[2]-lo[2])*(hatchZ-lo[0])/(next[0]-lo[0]);
 hatch(hatchZ,foreDeck+.028,.31,.32);
 const aft=start*L-.012;
 panel([-.36,D,aft],[-.34,D+rise*.82,aft],[.34,D+rise*.82,aft],[.36,D,aft],glass,.75);
 if(!d.wheel&&!d.skeg){
   for(const side of [-1,1]){
     const x=side*.24,z=-.435*L;
     rod([x,D+.08,z],[x,D+.34,z],.09,white);
     rod([x,D+.34,z],[x,D+.36,z+.08],.11,white);
     rod([x,D+.36,z+.081],[x,D+.36,z+.089],.079,glass);
   }
 }
 for(const side of [-1,1]){
   const foot=[side*B*.118,d.tackY-.12,L*.44],upper=[foot[0],foot[1]+.55,foot[2]];
   rod(foot,upper,.019,metal);rod(upper,[0,d.tackY+.43,L*.49],.019,metal);
   rod(upper,[side*B*.19,d.tackY+.37,L*.398],.019,metal);
 }
 const helmZ=-.35*L;
 if(d.wheel){
   rod([0,.48,helmZ],[0,D+.31,helmZ],.065,metal);
   const rim=a=>[.42*Math.cos(a),D+.31+.42*Math.sin(a),helmZ];
   for(let j=0;j<24;j++){rod(rim(j*Math.PI/12),rim((j+1)*Math.PI/12),.021,metal);
     if(j%4===0)rod([0,D+.31,helmZ],rim(j*Math.PI/12),.012,metal);}
 }else rod([0,.55,helmZ],[.72*Math.sin(b.rudderAngle||0),D+.17,helmZ+.94],.037,wood);
 const mast=y=>[0,y,d.mast],top=mast(d.top),tack=[0,d.tackY,d.bow];
 rod(mast(D),top,.061*L/12,metal);rod(tack,top,.012,metal);rod(top,[0,D+.12,-.475*L],.012,metal);
 for(const side of [-1,1]){
   const spread=[side*B*.34,D+d.I*.51,d.mast];
   rod(mast(spread[1]),spread,.026,metal);rod(top,spread,.012,metal);
   rod(spread,[side*B*.46,D,d.mast],.014,metal);
   rod(mast(spread[1]),[side*B*.46,D,d.mast-.45],.012,metal);
 }
 drawBrasilSpi(b,mast,rod,cloth,time,metal,metal,line,d);
 for(const main of [true,false]){
   const sh=main?b.mainSail:b.jibSail,hoist=main?1:brasilGenoaHoist(b);
   const point=(v,u)=>{
     const y=main?d.top-d.P*(1-v):d.tackY+d.I*v;
     const z=main?d.mast:d.bow-d.J*v, chord=(main?d.E:1.28*d.J)*(1-v);
     const a=(sh.angle||0)*(1+.09*v),draft=sotoMembrane(sh,a,v,u,chord,time,main);
     const flying=[chord*u*Math.sin(a)+draft*Math.cos(a),y+(main?0:.32*u*(1-v)),z-chord*u*Math.cos(a)+draft*Math.sin(a),u,v];
     if(hoist===1)return flying;
     const along=v*.26+(1-v)*u*.76,packed=[along*(.48+.16*Math.cos(v*25)),d.tackY-.20*along+.025*Math.sin(v*25),d.bow-d.J*along];
     return [...packed.map((n,k)=>n+(flying[k]-n)*hoist),u,v];
   };
   let before;
   const rows=b.i?8:16,cols=b.i?5:10;
   for(let i=0;i<=rows;i++){
     const row=Array.from({length:cols+1},(_,j)=>point(i/rows,j/cols));
     if(i)for(let j=1;j<=cols;j++)cloth(before[j-1],before[j],row[j],row[j-1],white,.78,16);
     before=row;
   }
   if(main){
     rod(point(0,0),point(0,1),.061,metal);
     for(const v of [.38,.57,.75,.89])rod(point(v,.68),point(v,1),.013,[.69,.68,.60]);
     rod(mast(D+.08),point(0,.24),.022,line);
   }
   rod(point(0,main?.73:1),[main?0:(b.lee||1)*B*.31,D+.16,main?-.29*L:-.24*L],.018,line);
 }
 for(let i=0;i<d.crew;i++){
   const side=i%2?1:-1,z=i===0?helmZ-.18:i===1?-.255*L:(-.15+.065*(i-2))*L;
   const x=side*B*(i<2?.20:.39),hip=[x,D+.04,z],shoulder=[x,D+.43,z+.05];
   rod(hip,shoulder,.12,i%2?[.28,.38,.48]:[.80,.72,.58]);rounded([x,D+.56,z+.06],[.083,.105,.087],[.70,.49,.35]);
   for(const k of [-1,1]){
     rod([x+k*.09,D+.36,z],[x+k*.16,D+.19,z+.15],.043,white);
     const knee=[x-side*.17,D+.02,z+k*.09+.16];rod(hip,knee,.071,glass);rod(knee,[knee[0],D-.22,knee[2]],.052,glass);
   }
 }
}
