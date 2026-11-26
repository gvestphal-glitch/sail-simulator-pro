/* Run with the published site's dist directory as the argument. */
const fs=require('node:fs'), path=require('node:path'),vm=require('node:vm');
const source=process.argv[2];
const read=n=>fs.readFileSync(path.join(source,n),'utf8');
const out=path.resolve(__dirname,'../Assets/Resources');
const game=read('game.js'), between=(a,b)=>game.slice(game.indexOf(a),game.indexOf(b,game.indexOf(a)));
const ctx={console,Image:class{},document:{createElement:()=>canvas},window:{matchMedia:()=>({matches:true})}};
const canvas={getContext:t=>t==='2d'?{}:null};ctx.canvas=canvas;
function save(name,v){
 if(!v.length||v.length%30||!v.every(Number.isFinite))throw Error(name);
 const count=v.length/10,b=Buffer.alloc(4+count*16);b.writeInt32LE(count);
 for(let i=0;i<count;i++){
  const j=i*10,k=4+i*16;
  b.writeFloatLE(v[j],k);b.writeFloatLE(v[j+1],k+4);b.writeFloatLE(-v[j+2],k+8);
  for(let c=0;c<4;c++)b[k+12+c]=Math.round(255*Math.max(0,Math.min(1,v[j+3+c])));
 }
 fs.writeFileSync(path.join(out,'Models',name+'.bytes'),b);
}
ctx.save=save;vm.createContext(ctx);
let scene=read('scene.js').replace('tube([0,boomY,rake(boomY)],cloth','flush("hull");tube([0,boomY,rake(boomY)],cloth').replace('tube([0,.49,mastZ],cloth','flush("main");tube([0,.49,mastZ],cloth').replace('const {angle:jibAngle','flush("lines");const {angle:jibAngle').replace('    function rounded(center,radii,color){','    flush(hasJib?"jib":"lines");\n    function rounded(center,radii,color){');
scene=scene.replace('return {draw};',`
 let prefix,pose;function flush(key){if(!pose||key==="crew")save(prefix+"-"+key+(pose?"-"+pose:""),mesh);mesh=[];}
 return {
 boat(k,variant){prefix=k;pose=variant;camera={eye:[3,3,8]};const sail={angle:0,camber:.10,flutter:0};
 model({i:0,x:0,y:0,h:0,heave:0,heel:0,pitch:0,color:"#334455",rudderAngle:0,lee:1,crewOffset:variant==="hike"?.52:.3,crewHike:variant==="hike"?1:.3,extraHike:variant==="hike"?1:0,starStand:variant==="mast"?1:0,rollRate:0,mainSail:sail,jibSail:sail},{course:{water:[1]},boatClass:k,oceanTime:0});flush("crew");},
 committee(){camera={eye:[3,3,8]};committeeLaunch({committee:{x:0,y:0},normal:{x:0,y:-1}},false,{conditions:{dir:0},course:{water:[]},oceanTime:0,signals:[]});save("committee",mesh);mesh=[];},
 coast(k,outline){makeLandscape(outline,k);save(k,landscapeMesh);}
 };`);
vm.runInContext('function waterSample(w){return {height:w.length?-20:0,slopeX:0,slopeZ:0};}'+scene+between('const coast=[','const alternatePlaces=')+`
 const render=createSailingScene(canvas);
 for(const k of ['ilca','snipe','optimist','star']){render.boat(k);render.boat(k,'hike');if(k==='star')render.boat(k,'mast');}
 render.committee();for(const k of ['santos','rio','canas'])render.coast(k,k==='santos'?coast:alternateCoast[k]);`,ctx);
vm.runInContext('const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));'+between('const classes={','let boatClass=')+between('function smoothStep','function idealSheet')+between('const starAngles=','function sailForces'),ctx);
const specs=vm.runInContext('classes',ctx);
for(const [k,s] of Object.entries(specs)){
 // Sample the original polar every degree and half knot; bilinear interpolation at runtime.
 const table=Buffer.alloc(121*181*4);
 const polar=vm.runInContext('polarKnots',ctx);
 for(let w=0;w<=120;w++)for(let a=0;a<=180;a++)table.writeFloatLE(polar(s,w/2,a),(w*181+a)*4);
 fs.writeFileSync(path.join(out,k+'-polar.bytes'),table);
}
