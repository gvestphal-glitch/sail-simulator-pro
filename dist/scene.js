"use strict";

function createSailingGraphics(canvas) {
  const options={alpha:false,antialias:true};
  const gl2=canvas.getContext("webgl2",options);
  const gl=gl2||canvas.getContext("webgl",options);
  const software=gl?null:canvas.getContext("2d");
  const features={
    backend:gl2?"WebGL 2":gl?"WebGL 1":software?"Canvas 2D":"—",
    canvasAntialias:gl?.getContextAttributes()?.antialias===true,
    maxTextureSize:gl?gl.getParameter(gl.MAX_TEXTURE_SIZE):0,
    nativeInstancing:!!gl2,hdrColorDepth:false,hdrMsaaSamples:0
  };
  if(gl2 && gl2.getExtension("EXT_color_buffer_float"))probeHdr(gl2,features);
  return {gl2,gl,software,features};
}

// Testa cor e profundidade juntas, em alvos descartáveis de apenas 4×4.
function probeHdr(gl,features){
  const read=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
  const draw=gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
  const boundTex=gl.getParameter(gl.TEXTURE_BINDING_2D);
  const boundRb=gl.getParameter(gl.RENDERBUFFER_BINDING);
  const fb=gl.createFramebuffer(),tex=gl.createTexture();
  const depth=gl.createRenderbuffer(),color=gl.createRenderbuffer();
  try{
    if(!fb||!tex||!depth)return;
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA16F,4,4);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,tex,0);
    gl.bindRenderbuffer(gl.RENDERBUFFER,depth);
    gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT24,4,4);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depth);
    const complete=()=>gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE;
    features.hdrColorDepth=complete();
    if(!features.hdrColorDepth||!color)return;

    // Só experimentar contagens anunciadas para ambos os formatos.
    const counts=format=>gl.getInternalformatParameter(gl.RENDERBUFFER,format,gl.SAMPLES)||[];
    const depthCounts=counts(gl.DEPTH_COMPONENT24);
    const candidates=Array.from(counts(gl.RGBA16F)).filter(n=>n>=2&&n<=4&&depthCounts.includes(n));
    for(const n of candidates.sort((a,b)=>b-a)){
      gl.bindRenderbuffer(gl.RENDERBUFFER,color);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER,n,gl.RGBA16F,4,4);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.RENDERBUFFER,color);
      gl.bindRenderbuffer(gl.RENDERBUFFER,depth);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER,n,gl.DEPTH_COMPONENT24,4,4);
      if(complete()){features.hdrMsaaSamples=n;break;}
    }
  }finally{
    // Restaurar os bindings antes de iniciar os passes de mar e reflexos.
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER,read);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,draw);
    gl.bindRenderbuffer(gl.RENDERBUFFER,boundRb);
    gl.bindTexture(gl.TEXTURE_2D,boundTex);
    gl.deleteFramebuffer(fb);gl.deleteRenderbuffer(color);
    gl.deleteRenderbuffer(depth);gl.deleteTexture(tex);
  }
}

function createSailingScene(canvas){
  const {gl2,gl,software,features}=createSailingGraphics(canvas);
  if(new URLSearchParams(location.search).get("graphics")==="1"){
    const report=document.getElementById("graphics-report");
    report.textContent=[features.backend,"RGBA16F "+(features.hdrColorDepth?"✓":"—"),
      "HDR MSAA "+features.hdrMsaaSamples+"×","Instancing "+(features.nativeInstancing?"✓":"—")].join(" · ");
    report.hidden=false;
  }
  if(!gl&&!software)return null;

  function breakerStrength(knots){
    return knots>15?.22+.78*Math.min(1,(knots-15)/14):0;
  }
  const outputColor=`
    uniform float linearTarget;
    vec3 toLinear(vec3 c){return pow(max(c,vec3(0.)),vec3(2.2));}
    vec3 displayColor(vec3 c){return linearTarget>.5?c:pow(max(c,vec3(0.)),vec3(1./2.2));}
  `;
  const skyFragment=`
    precision highp float;
    varying vec2 pixel;
    ${outputColor}
    uniform vec3 eye, forward, right, up;
    uniform vec2 lens;
    uniform vec4 waves[4];
    uniform vec3 offsets[4];
    uniform float clock, skyMode;
    uniform vec4 windSettings;
    uniform vec3 seaTint;
    uniform samplerCube shoreReflection;
    uniform sampler2D boatReflection;
    uniform vec2 boatCenter;
    uniform sampler2D detailMap,marineMap;
    float gustAt(vec2 p){
      vec2 axis=windSettings.xy;
      float a=dot(p,axis),b=dot(p,vec2(-axis.y,axis.x));
      float gustClock=clock*(.22+.062*clamp(windSettings.z,0.,55.));
      float front=a*.070+gustClock*.45+1.45*sin(b*.089);
      float detailPatch=.5+.5*sin(b*.056-a*.021+gustClock*.10);
      float ridge=max(0.,cos(front));
      return ridge*ridge*ridge*ridge*(.30+.70*detailPatch);
    }
    vec3 surface(vec2 point){
      vec3 result=vec3(0.);
      for(int i=0;i<4;i++){
        vec4 w=waves[i];
        vec3 o=offsets[i];
        float phase=dot(point,w.xy)*w.z+o.x*clock+o.y;
        float c=cos(phase),s=sin(phase);
        result+=vec3(w.w*(c+o.z*(2.*c*c-1.)),-w.xy*w.z*w.w*s*(1.+4.*o.z*c));
      }
      return result;
    }
    uniform vec3 sun;
    uniform sampler2D foamField;
    uniform vec2 foamCenter;
    float hash(vec2 p){
      vec3 q=fract(vec3(p.xyx)*.1031);
      q+=dot(q,q.yzx+33.33);
      return fract((q.x+q.y)*q.z);
    }
    float noise(vec2 p){
      vec2 i=floor(p), f=fract(p);
      f=f*f*(3.-2.*f);
      return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),
        mix(hash(i+vec2(0.,1.)),hash(i+1.),f.x),f.y);
    }
    float clouds(vec2 p){
      return .59*noise(p)+.26*noise(p*2.06+7.8)+.11*noise(p*4.23+3.7)+.04*noise(p*8.4);
    }
    vec3 atmosphere(vec3 ray){
      float height=max(ray.y,0.0);
      float glow=max(dot(ray,sun),0.0);
      vec3 sky=mix(vec3(.76,.84,.86),vec3(.26,.52,.71),pow(clamp(height*1.45,0.,1.),.54));
      sky+=vec3(.19,.148,.09)*pow(glow,7.)+vec3(.87,.69,.42)*smoothstep(.9989,.99965,glow);
      vec2 p=ray.xz/(.23+height)*3.6+vec2(clock*.003,1.7);
      float field=clouds(p);
      if(skyMode<-.5)return sky;
      float cover=smoothstep(.49,.67,field)*smoothstep(.014,.18,height);
      float edge=smoothstep(-.067,.14,field-clouds(p+vec2(-.23,-.28)));
      float softness=smoothstep(.47,.72,field);
      vec3 cloud=mix(vec3(.55,.63,.70),vec3(1.0,.974,.912),edge*.73+softness*.27);
      vec2 high=ray.xz/(.47+height)*vec2(4.9,1.8)+vec2(7.1,clock*.002);
      float cirrus=smoothstep(.62,.88,clouds(high))*smoothstep(.08,.45,height);
      sky=mix(sky,vec3(.77,.85,.90),cirrus*.48);
      float underside=smoothstep(.38,.65,field)*smoothstep(.13,.51,height);
      cloud-=vec3(.11,.092,.067)*underside*(1.-edge);
      cloud+=vec3(.14,.094,.043)*pow(glow,12.)*cover;
      if(skyMode>.5){
        vec3 deck=mix(vec3(.37,.44,.50),vec3(.76,.79,.80),field*.67+.33*edge);
        return mix(deck,deck*vec3(.71,.76,.83),step(1.5,skyMode));
      }
      return mix(sky,cloud,cover*.96);
    }
    void main(){
      vec3 ray=normalize(forward+right*pixel.x*lens.x+up*pixel.y*lens.y);
      if(ray.y>=-.0001){gl_FragColor=vec4(displayColor(toLinear(atmosphere(ray))),1.);return;}
      float depth=-eye.y/ray.y;
      vec2 p=eye.xz+depth*ray.xz;
      vec3 field=surface(p);
      float detail=exp(-depth*.021);
      vec2 wind=waves[2].xy, across=vec2(-wind.y,wind.x);
      float a=dot(p,wind), b=dot(p,across);
      float rippleClock=clock*(.26+.062*clamp(windSettings.z,0.,55.));
      vec2 flow=vec2(a*.21+rippleClock*.19,b*.31-rippleClock*.052);
      float warp=noise(flow);
      float rippleWarp=3.4*warp+1.5*sin(b*.34+a*.12+rippleClock*.41);
      float pulse=depth<380.?gustAt(p):0.;
      float localWind=windSettings.z+windSettings.w*pulse;
      float breakers=localWind>15.?.22+.78*min(1.,(localWind-15.)/14.):0.;
      float gustTexture=pulse*min(1.,windSettings.w*.31)*(1.-smoothstep(110.,380.,depth));
      float group=.38+.62*warp+.95*gustTexture;
      float first=sin(a*3.63+b*1.43+rippleClock*4.8+rippleWarp);
      float second=sin(a*6.22-b*2.35+rippleClock*6.6-rippleWarp);
      // Crossing short ripples break the crest reflections between the larger wave groups.
      float shortWaves=sin(a*2.18-b*2.87-rippleClock*3.1+5.3*warp);
      float oblique=sin(a*.92+b*1.6+rippleClock*1.41+2.*warp);
      vec2 grains=(wind*.044*first+across*.034*second)*detail*group
        +(wind*.012-across*.025)*shortWaves*exp(-depth*.018)
        +(wind*.027+across*.015)*oblique*exp(-depth*.0075);
      float capillary=sin(10.1*a+3.7*b+rippleClock*9.4+2.8*second+warp);
      grains+=(.014*wind+.008*across)*capillary*group*(1.-smoothstep(6.,24.,depth));
      vec2 rippleUv=vec2(a*.20+rippleClock*.17,b*.23)+vec2(warp*.12);
      vec2 ripple=mix(texture2D(detailMap,rippleUv).ba,texture2D(detailMap,mat2(.81,.59,-.59,.81)*rippleUv*.63+flow*.04).ba,.44)-.5;
      grains+=(wind*ripple.x+across*ripple.y)*(.067+.032*gustTexture)*detail;
      float textureGain=min(1.9,localWind*.086);
      grains*=textureGain;
      float slopeDetail=1.-.38*smoothstep(19.,168.,depth);
      vec3 normal=normalize(vec3(-field.y*slopeDetail+grains.x,1.,-field.z*slopeDetail+grains.y));
      float fresnel=.035+.965*pow(1.-clamp(dot(normal,-ray),0.,1.),5.);
      vec3 reflected=reflect(ray,normal);
      float height=max(0.,reflected.y);
      vec3 reflectedSky=mix(vec3(.70,.79,.82),vec3(.20,.43,.64),sqrt(height));
      // A single broad layer stays inexpensive in the water pass.
      if(skyMode>=-.5){
        vec2 cloudRay=reflected.xz/(.23+height)*3.6+vec2(clock*.003,1.7);
        float cloudReflection=smoothstep(.49,.79,noise(cloudRay))*smoothstep(.02,.25,height);
        reflectedSky=mix(reflectedSky,vec3(.82,.85,.85),cloudReflection*.58);
      }
      if(skyMode>.5)reflectedSky=mix(reflectedSky,vec3(.51,.58,.62),.62);
      // The reflected ray samples the actual venue. Short wave normals break
      // the skyline into moving bands, strongest at grazing incidence.
      vec4 shore=textureCube(shoreReflection,vec3(reflected.x,max(.002,reflected.y),reflected.z));
      reflectedSky=mix(reflectedSky,shore.rgb,.81*shore.a);
      vec3 waterColor=seaTint+vec3(.023,.054,.046)*field.x;
      float facing=pow(max(0.,dot(ray,sun)),5.);
      waterColor+=vec3(.018,.074,.059)*facing*smoothstep(.12,.58,normal.y);
      vec3 water=mix(waterColor,reflectedSky,fresnel);
      float separation=length(p-boatCenter);
      if(separation<32.){
        vec2 uv=pixel*.5+.5;
        vec2 slope=vec2(dot(normal.xz,right.xz),dot(normal.xz,forward.xz));
        uv+=slope*vec2(.067,.091)/lens+vec2(0.,field.x*.025);
        vec4 boat=texture2D(boatReflection,uv);
        float exposure=(.19+.69*fresnel)*(1.-smoothstep(12.,32.,separation));
        water=mix(water,boat.rgb,boat.a*exposure);
      }
      water*=1.-.21*gustTexture;
      float facets=noise(vec2(a*.88+clock*.54+rippleWarp*.23,b*1.25+warp));
      water+=vec3(.015,.043,.049)*(facets-.45)*detail*textureGain;
      float chop=noise(vec2(a*.57+b*.23+warp*.57,b*.77-clock*.31));
      water=mix(water,water*(.88+.24*chop),detail*group*.45*min(1.6,textureGain));
      reflected=normalize(reflected+vec3(wind.x,0.,wind.y)*(facets-.5)*detail*.055);
      float glint=max(dot(reflected,sun),0.);
      float roughness=mix(230.,65.,clamp(breakers+abs(grains.x)*6.,0.,1.));
      float direct=skyMode>.5?.20:1.;
      float specularBreakup=.37+.63*smoothstep(.28,.72,facets);
      water+=direct*(vec3(.19,.17,.13)*pow(glint,26.)+vec3(.84,.74,.59)*pow(glint,roughness)*specularBreakup);
      float crestGlare=smoothstep(.49,.96,oblique)*smoothstep(.46,.79,chop)*detail;
      water+=vec3(.11,.20,.23)*crestGlare*fresnel*.51*textureGain;
      if(breakers>0. && depth<530.){
        float phase=a*waves[2].z+offsets[2].x*clock+offsets[2].y;

        // A slowly travelling gust envelope breaks each crest into separate whitecaps.
        vec2 fetch=vec2(a*.047+rippleClock*.073,b*.083);
        float gust=noise(fetch);
        float bend=noise(fetch*2.7+vec2(9.4,-2.1));
        vec2 drift=vec2(a*.51+rippleClock*.32+bend*2.7,b*.29+gust*2.2);
        float detailPatch=noise(drift)+.19*noise(drift*3.6);
        float islands=smoothstep(.70-.24*breakers,.83-.24*breakers,detailPatch);
        float localPhase=phase+(bend-.5)*2.1+(detailPatch-.5)*1.5;
        float ridge=cos(localPhase);
        islands*=smoothstep(.32,.69,gust+.13*(bend-.5));
        float crest=smoothstep(.84-.32*gust,.99,ridge);
        float grain=noise(vec2(drift.x*5.+detailPatch*3.,drift.y*8.+bend*2.));
        float lace=mix(.78,.28+.72*smoothstep(.25,.64,grain),1.-smoothstep(18.,85.,depth));
        float fringe=smoothstep(.32,.86,ridge)*smoothstep(.55,.94,sin(localPhase))*(.16+.44*bend);
        crest=max(crest,fringe);
        // Aerated water persists briefly on the downwind shoulder of a breaking crest.
        float wash=smoothstep(-.15,.70,cos(localPhase+.82))*smoothstep(.10,.90,-sin(localPhase));
        float foam=max(crest,.43*breakers*wash)*islands*lace*breakers*(1.-smoothstep(100.,530.,depth));
        float bubbles=texture2D(marineMap,drift*.42+vec2(bend*.15,0.)).r;
        foam*=mix(.44+1.10*bubbles,1.,smoothstep(12.,72.,depth));
        water=mix(water,mix(vec3(.67,.82,.81),vec3(.96,.98,.96),crest),foam);
      }
      vec2 foamUv=(p-foamCenter)/128.+.5;
      if(all(greaterThan(foamUv,vec2(0.)))&&all(lessThan(foamUv,vec2(1.)))){
        float wash=texture2D(foamField,foamUv+grains*.003).r;
        water=mix(water,vec3(.78,.88,.87),wash*(.46+.49*facets));
      }
      vec3 horizon=skyMode>.5?vec3(.58,.65,.70):vec3(.76,.84,.86);
      if(depth>1300.)horizon=atmosphere(normalize(vec3(ray.x,.001,ray.z)));
      water=mix(water,horizon,1.-exp(-max(depth-85.,0.)*.0015));
      gl_FragColor=vec4(displayColor(toLinear(water)),1.);
    }`;
  // Shared by the colour, reflected silhouette and deck-shadow passes.
  const sailMotion=`
    uniform float sceneTime, breeze;
    vec3 sailPoint(vec3 p,vec3 uvKind,float sheetHeading){
      if(uvKind.z<20.)return p;
      vec2 uv=uvKind.xy;
      float batten=uvKind.z<21.?abs(sin(uv.y*15.708)):1.;
      float freeEdge=smoothstep(.2,1.,uv.x)*sin(3.14159*uv.y);
      float load=fract(uvKind.z)*2.;
      float phase=sceneTime*(3.+.12*min(breeze,35.))-7.*uv.y-3.*uv.x;
      float travel=(.008+.065*load)*min(breeze*.15,1.)*freeEdge*batten;
      return p+vec3(cos(sheetHeading),0.,sin(sheetHeading))*travel*(sin(phase)+.32*sin(phase*1.67));
    }`;
  const objectVertex=`
    attribute vec3 point;
    attribute vec4 shade;
    attribute vec3 finish;
    ${sailMotion}
    varying vec3 surface;
    varying vec4 color;
    varying float distanceToEye;
    varying vec2 shadowUv;
    varying float receiverHeight;
    varying vec3 world;
    uniform vec3 eye, forward, right, up;
    uniform vec2 lens;
    uniform vec3 shadowCenter;
    uniform float boatWater, waveLimit;
    uniform vec4 boatWaves[4];
    uniform vec2 boatPhases[4];
    varying float immersion;
    void main(){
      world=sailPoint(point,finish,shade.a);
      immersion=-2.;
      if(boatWater>.5){
        float level=0.;
        if(world.y<waveLimit+.25)for(int i=0;i<4;i++){
          vec4 w=boatWaves[i];
          float c=cos(w.z*dot(w.xy,world.xz)+boatPhases[i].x);
          level+=w.w*(c+boatPhases[i].y*(2.*c*c-1.));
        }
        immersion=level-world.y;
      }
      shadowUv=(world.xz-shadowCenter.xz-(world.y-shadowCenter.y)*vec2(-.42,-.736)/.53)/48.+.5;
      receiverHeight=(world.y-shadowCenter.y+8.)/36.;
      vec3 delta=world-eye;
      float z=dot(delta,forward);
      distanceToEye=length(delta);
      gl_Position=vec4(dot(delta,right)/lens.x,dot(delta,up)/lens.y,1.000036*z-.36,z);
      color=shade; surface=finish;
    }`;
  const objectFragment=`
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif
    varying float immersion;
    varying vec4 color;
    varying float distanceToEye;
    varying vec2 shadowUv;
    varying float receiverHeight;
    varying vec3 world;
    varying vec3 surface;
    uniform sampler2D clubCrest,detailMap,deckShadow,marineMap,sailCloth;
    uniform float shadowStrength;
    uniform float sceneTime;
    uniform vec3 distanceHaze,eye;
    uniform sampler2D responseMap;
    #ifdef PBR
    uniform samplerCube marineLight;
    uniform sampler2D classMarks,coastGrain,brightwork;
    uniform vec4 badge; // atlas cell x/y, width in sail UV, height in sail UV
    #endif
    ${outputColor}
    float groundNoise(vec2 p){
      vec2 i=floor(p), f=fract(p);
      f=f*f*(3.-2.*f);
      vec4 a=mod(vec4(i.x,i.x+1.,i.x,i.x+1.),97.);
      vec4 b=mod(vec4(i.y,i.y,i.y+1.,i.y+1.),89.);
      vec4 h=fract(sin(a*1.63+b*2.71)*211.23);
      return mix(mix(h.x,h.y,f.x),mix(h.z,h.w,f.x),f.y);
    }
    void main(){
      vec3 pigment=color.rgb;
      float opacity=color.a;
      if(surface.z>=20.){
        opacity=1.;
        pigment*=.72+.56*texture2D(sailCloth,surface.xy).r;
      }else if(surface.z>17.5){
        vec2 markUv=vec2(gl_FrontFacing?surface.x:1.-surface.x,surface.y);
        vec4 markings=texture2D(sailCloth,markUv);
        pigment*=.54+.83*texture2D(sailCloth,surface.xy).r;
        if(surface.z>18.5){
          #ifndef PBR
          pigment=mix(pigment,vec3(.84,.86,.82),1.-markings.a);
          #endif
        }else{
          pigment=mix(pigment,vec3(.77,.79,.74),max(0.,markings.b-.502)*1.75);
          pigment*=1.-max(0.,.502-markings.b)*.68;
        }
      }else if(surface.z>16.5){
        float nylon=texture2D(sailCloth,surface.xy).g;
        vec2 uv=clamp(surface.xy,0.,1.);
        float edge=min(uv.x,1.-uv.x);
        float course=uv.y-.030*sin(3.14159*uv.x)*sin(3.14159*uv.y);
        // Radial head gores, cross panels amidships and mirrored corner fans.
        vec2 fan=vec2(edge,uv.y);
        float bearing=atan(fan.y,max(.00001,fan.x));
        float gore=abs(fract(uv.x*12.+.5)-.5)/12.;
        float fanSeam=length(fan)*abs(sin(bearing*8.))/8.;
        float transverse=min(abs(course-.34),min(abs(course-.51),abs(course-.70)));
        float seam=min(transverse,course<.34?min(fanSeam,abs(uv.x-.5)):gore);
        seam=min(seam,min(edge,uv.y));
        float pixel=.0022;
        #ifdef PBR
        pixel=clamp(max(fwidth(uv.x),fwidth(uv.y))*.64,.0006,.035);
        #endif
        float overlap=(1.-smoothstep(.0011,.0011+pixel,seam))*min(1.,.007/pixel);
        float stitch=(1.-smoothstep(.00045,.00045+pixel,abs(seam-.0028)))*min(1.,.002/pixel);
        if(surface.z>17.12){
          // Coloured crown and corner gores on the classic runner.
          float band=course>.70?floor(edge*12.):floor(bearing*8./3.14159);
          vec3 dye=band<1.?vec3(.15,.34,.79):band<2.?vec3(.97,.75,.13):
                   band<3.?vec3(.85,.16,.19):vec3(1.);
          if(course>.70||(course<.34 && bearing>.39))pigment*=dye;
        }
        pigment*=(.95+.085*nylon)*(1.-.39*overlap-.14*stitch);
        opacity*=.95;
      }else if(surface.z>15.5){
        float tape=texture2D(sailCloth,surface.xy).r;
        pigment*=.54+.83*tape;
      }else if(surface.z>14.5){
        float grain=texture2D(marineMap,surface.xy*2.).g;
        vec2 grooves=abs(fract(surface.xy*vec2(1.7,.86)+.5)-.5);
        float joint=1.-smoothstep(.002,.008,min(grooves.x,grooves.y));
        pigment*=(.82+.35*grain)*(1.-.17*joint);
      }else if(surface.z>13.5){
        // Woven buoyancy-aid panels, contrasting side gussets and bound armholes.
        vec2 uv=surface.xy;
        float textile=texture2D(marineMap,uv*vec2(1.8,2.4)).g;
        float gusset=smoothstep(.60,.87,abs(uv.x));
        float piping=1.-smoothstep(.016,.055,abs(abs(uv.x)-.68));
        pigment=mix(pigment,vec3(.065,.095,.115),gusset*.83);
        pigment*=.84+.34*textile;
        pigment+=vec3(.23,.28,.28)*piping;
      }else if(surface.z>12.5){
        vec2 drop=(surface.xy-.5)*vec2(2.,2.);
        float radius=dot(drop,drop);
        opacity*=1.-smoothstep(.17,1.,radius);
        if(opacity<.025)discard;
      }else if(surface.z>11.5){
        // Leave holes between the filaments so the water remains visible.
        vec2 uv=surface.xy;
        float bend=groundNoise(vec2(uv.x*2.4,uv.y*.65));
        float cells=groundNoise(vec2(uv.x*7.+bend*2.,uv.y*3.6+bend));
        float lace=1.-smoothstep(.036,.18,abs(cells-.51));
        vec2 rolled=vec2(uv.x*1.9,uv.y*.40)+vec2(bend*.31,.07*sceneTime);
        float bubbles=texture2D(marineMap,rolled).r;
        lace=mix(lace,bubbles,.65);
        float envelope=sin(3.14159*clamp(uv.x,0.,1.));
        opacity*=envelope*(.16+.84*lace)*(.47+.53*bend);
        pigment=mix(vec3(.43,.73,.72),pigment,lace);
      }else if(surface.z>10.5){
        vec2 uv=surface.xy;
        float torn=groundNoise(vec2(uv.x*.76,uv.y*8.+sceneTime*.42));
        float surge=fract(uv.y+sceneTime*.29+groundNoise(vec2(uv.x*.18,4.))* .32);
        float line=smoothstep(.65,.94,surge)*(1.-smoothstep(.955,.999,surge));
        opacity*=line*smoothstep(.28,.72,torn)*(1.-uv.y);
        if(opacity<.035)discard;
      }else if(surface.z>7.5){
        vec2 uv=surface.xy;
        float coarse=groundNoise(uv*.55);
        float fine=mix(.5,groundNoise(uv*4.2),1.-smoothstep(360.,1400.,distanceToEye));
        if(surface.z<8.5){
          vec2 strata=vec2(uv.x*.31+uv.y*1.65,uv.y*.23-uv.x*.57);
          float seam=smoothstep(.62,.85,groundNoise(strata+coarse*.9));
          float mineral=texture2D(marineMap,uv*.78).b;
          #ifdef PBR
          float fracture=texture2D(coastGrain,strata*.48).r;
          pigment*=.83+.34*fracture;
          #endif
          pigment+=vec3(.14,.12,.095)*(mineral-.46);
          float veins=groundNoise(vec2(uv.x*.89+uv.y*.18,uv.y*.082));
          pigment*=.63+.37*coarse+.23*fine+.31*veins-.26*seam;
        }else if(surface.z<9.5){
          float grains=texture2D(marineMap,uv*1.36).b;
          #ifdef PBR
          float sand=texture2D(coastGrain,uv*.31).g;
          pigment*=.83+.32*sand;
          pigment=mix(pigment,pigment*vec3(.77,.81,.83),1.-smoothstep(.15,1.05,world.y));
          #endif
          pigment*=.78+.19*coarse+.12*fine+.17*grains;
        }else{
          vec2 tiles=vec2(uv.x+floor(uv.y)*.32,uv.y);
          float joints=smoothstep(.074,.15,fract(tiles.y));
          pigment*=.76+.23*joints+.18*fine+.15*(coarse-.5);
        }
      }else if(surface.z>6.5){
        vec2 uv=surface.xy;
        vec2 cell=floor(uv);
        float blinds=step(.68,fract(sin(dot(cell,vec2(12.9898,78.233)))*4375.85));
        float edge=smoothstep(.05,.12,fract(uv.x))*smoothstep(.05,.12,1.-fract(uv.x));
        float reflection=smoothstep(.25,.95,fract(uv.y));
        pigment=mix(pigment*.67,pigment+vec3(.13,.16,.17)*reflection,edge);
        pigment=mix(pigment,pigment*.64+vec3(.24,.22,.17),blinds*.6);
      }else if(surface.z>5.5){
        vec2 uv=surface.xy;
        float detailPatch=groundNoise(uv*.43);
        float trees=groundNoise(uv*3.5+detailPatch*.9);
        float crown=groundNoise(uv*13.);
        float detail=1.-smoothstep(520.,2600.,distanceToEye);
        float shadow=smoothstep(.08,.43,trees);
        pigment*=.56+.35*detailPatch+.24*shadow+.17*trees+(crown-.5)*detail*.29;
        float leaves=texture2D(detailMap,uv*.43).r;
        #ifdef PBR
        float clusters=texture2D(coastGrain,uv*.27+detailPatch*.07).b;
        pigment*=.78+.41*clusters;
        #endif
        pigment*=.84+.34*leaves;
        float canopy=smoothstep(.41,.75,trees+.25*(crown-.5));
        pigment=mix(pigment,pigment*vec3(.83,.92,1.04),1.-canopy);
        pigment+=vec3(.055,.047,.013)*canopy*detailPatch;
        pigment+=vec3(.053,.062,.023)*smoothstep(.54,.81,detailPatch)*trees;
      }else if(surface.z>3.5){
        float flecks=sin(surface.x*68.+3.*sin(surface.y*22.))*sin(surface.y*113.+2.*sin(surface.x*19.));
        pigment=mix(pigment*.66,pigment, smoothstep(-.53,.65,flecks));
      }else if(surface.z>2.5){
        pigment=texture2D(clubCrest,surface.xy).rgb;
      }else if(surface.z>.5){
        vec2 uv=surface.xy;
        float nearby=1.-smoothstep(3.,14.,distanceToEye);
        if(abs(surface.z-1.30)<.03){
          float crossPlank=uv.x+.018*uv.x*uv.y*uv.y;
          float strip=crossPlank/.088;
          float joint=abs(fract(strip+.5)-.5);
          float nearDeck=1.-smoothstep(7.,30.,distanceToEye);
          float grain=texture2D(marineMap,vec2(crossPlank*5.,uv.y*.37)).g;
          #ifdef PBR
          grain=texture2D(brightwork,vec2(crossPlank*.95,uv.y*.39+fract(floor(strip+.5)*.618))).r;
          #endif
          pigment*=.78+.41*grain-.43*(1.-smoothstep(.008,.037,joint))*nearDeck;
        }else if(abs(surface.z-1.43)<.025){
          #ifdef PBR
          float grain=texture2D(brightwork,uv).r;
          pigment*=.67+.62*grain;
          #endif
        }else if(surface.z<1.5){
          // Shallow, crossed moulded grip in the working areas of the deck.
          vec2 ribs=cos((uv.x+vec2(uv.y,-uv.y))*190.);
          float grip=texture2D(marineMap,uv*2.6).g;
          pigment*=.97+nearby*(.052*min(ribs.x,ribs.y)+.21*(grip-.5));
        }else{
          float bias=uv.x+.27*uv.y;
          float yarn=cos(bias*180.)*cos(uv.y*164.);
          float tension=sin(bias*27.+2.4*sin(uv.y*4.));
          float broadFold=sin(uv.y*5.6+bias*2.1+1.6*sin(bias*1.6));
          float roachLight=smoothstep(.18,2.4,uv.x);
          pigment*=.973+.015*tension+.018*nearby*yarn+.025*broadFold*roachLight;
          float weave=texture2D(detailMap,uv*.83).g;
          pigment*=.93+.14*weave;
          pigment+=vec3(.018,.013,.004)*roachLight;
        }
      }
      #ifdef PBR
      bool marked=abs(surface.z-2.25)<.02 || abs(surface.z-18.)<.02 ||
        abs(surface.z-19.)<.02 || (surface.z>=20. && surface.z<21.);
      if(marked){
        vec2 logo=(surface.xy-vec2(.49,.76))/badge.zw;
        if(!gl_FrontFacing)logo.x=-logo.x;
        vec2 cell=clamp(logo*vec2(1.,-1.)+.5,.002,.998);
        vec4 ink=texture2D(classMarks,(badge.xy+cell)/vec2(4.,2.));
        pigment=mix(pigment,ink.rgb,ink.a);
      }
      #endif
      vec3 radiance=toLinear(pigment);
      #ifdef PBR
      bool cloth=surface.z>=15.5;
      bool deck=(surface.z>.5 && surface.z<1.5)||abs(surface.z-15.)<.1;
      bool carbon=surface.z<=-3.;
      bool alloy=surface.z< -1.5 && !carbon;
      if(deck || cloth || surface.z<-.5){
        vec3 dx=dFdx(world),dy=dFdy(world);
        vec3 N=normalize(cross(dx,dy)),V=normalize(eye-world);
        if(dot(N,V)<0.)N=-N;
        vec2 uv=surface.xy;
        vec4 response=texture2D(responseMap,uv*(cloth?5.:2.));
        vec2 du=dFdx(uv),dv=dFdy(uv);
        vec3 T=dx*dv.y-dy*du.y,B=dy*du.x-dx*dv.x;
        float inv=inversesqrt(max(max(dot(T,T),dot(B,B)),1.e-10));
        vec2 relief=(response.rg*2.-1.)*(deck?.36:cloth?.09:.04);
        vec3 coatNormal=N;
        if(carbon){
          // Millimetre-scale tow bundles. Fade frequencies beyond the pixel footprint.
          vec2 cell=uv*170.;
          float resolved=1.-smoothstep(.18,.65,max(fwidth(cell.x),fwidth(cell.y)));
          vec2 wave=sin(6.28318*cell);
          float over=.5+.5*cos(3.14159*cell.x)*cos(3.14159*cell.y);
          relief=.16*resolved*vec2(wave.x*over,wave.y*(1.-over));
          radiance=mix(vec3(.022,.029,.034),radiance,.18)*(.89+.11*resolved*(2.*over-1.));
        }
        N=normalize(N+(T*relief.x+B*relief.y)*inv*sign(du.x*dv.y-du.y*dv.x));
        vec3 L=normalize(vec3(-.42,.53,-.736)),H=normalize(V+L);
        float nv=max(.025,dot(N,V)),nl=max(0.,dot(N,L)),nh=max(0.,dot(N,H));
        float rough=clamp((deck?.82:cloth?.65:alloy?.28:.36)*(.72+.40*response.b),.16,1.);
        if(abs(surface.z-1.43)<.025)rough=.27+.09*response.b;
        float metallic=alloy?response.a:0.;
        vec3 f0=mix(vec3(.04),radiance,metallic);
        vec3 F=f0+(1.-f0)*pow(1.-max(0.,dot(V,H)),5.);
        float a2=pow(rough,4.),d=nh*nh*(a2-1.)+1.;
        float D=a2/(3.14159*d*d),k=(rough+1.)*(rough+1.)*.125;
        vec3 spec=D*F/(4.*mix(nv,1.,k)*mix(nl,1.,k));
        float visibility=1.;
        if(all(lessThan(abs(shadowUv-.5),vec2(.495)))){
          float occlusion=0.;
          for(int x=-1;x<=1;x++)for(int y=-1;y<=1;y++){
            float h=texture2D(deckShadow,shadowUv+vec2(float(x),float(y))*1.65/512.).r;
            occlusion+=smoothstep(receiverHeight+.003,receiverHeight+.012+.003*(1.-nl),h);
          }
          visibility-=shadowStrength*occlusion/9.;
        }
        vec3 hemi=mix(vec3(.20,.31,.32),vec3(.64,.75,.88),N.y*.5+.5);
        vec3 reflected=mix(vec3(.13,.25,.26),vec3(.72,.83,1.),reflect(-V,N).y*.5+.5);
        // Grazing reflection on polished gear and hull paint; preserve deck grip.
        if(alloy || abs(surface.z+1.)<.02){
          float edge=pow(1.-nv,5.);
          f0=mix(f0,vec3(1.),edge*(alloy?.66:.48));
        }
        vec3 base=radiance;
        radiance=hemi*base*(1.-metallic)+reflected*f0
          +visibility*(.3+.7*shadowStrength)*nl*((1.-F)*base*(1.-metallic)+spec*2.4);
        if(carbon){
          float wet=clamp((-3.-surface.z)*2.,0.,1.);
          vec3 ray=reflect(-V,coatNormal);
          // Distort only the reflected sea hemisphere as the wave highlights travel.
          float sea=smoothstep(.08,.48,-ray.y);
          ray.xz+=sea*.036*vec2(sin(world.z*.85+sceneTime*1.7),sin(world.x*.9-sceneTime*1.3));
          float coatF=.04+.96*pow(1.-clamp(dot(coatNormal,V),0.,1.),5.);
          vec3 env=textureLod(marineLight,normalize(ray),mix(1.1,.25,wet)).rgb;
          radiance=radiance*(1.-coatF)*(1.-.16*wet)+coatF*env;
        }
        if(surface.z>=20.){
          // Corner patches, luff tape and mainsail battens transmit less sunlight.
          float corners=min(length(uv),min(length(uv-vec2(1.,0.)),length(uv-vec2(0.,1.))));
          float thin=smoothstep(.015,.15,corners)*smoothstep(.008,.04,uv.x);
          if(surface.z<21.)thin*=.62+.38*smoothstep(.02,.15,abs(sin(uv.y*15.708)));
          float back=clamp((.22-dot(N,L))/1.22,0.,1.);
          radiance+=vec3(.24,.204,.142)*thin*back*visibility*shadowStrength;
        }else if(cloth)radiance+=base*.28*max(0.,-dot(N,L))*visibility;
      }
      #else
      if(abs(surface.z-1.)<.1 && all(lessThan(abs(shadowUv-.5),vec2(.495)))){
        float shade=0.;
        for(int i=0;i<4;i++){
          vec2 o=vec2(mod(float(i),2.),floor(float(i)/2.))-.5;
          shade+=step(receiverHeight+.006,texture2D(deckShadow,shadowUv+o/512.).r)*.25;
        }
        radiance*=1.-.34*shade*shadowStrength;
      }
      #endif
      if(immersion>.012 && abs(surface.z+.35)<.01)discard;
      if(immersion>0.){
        float wet=smoothstep(0.,.075,immersion);
        float path=immersion/max(.35,abs(eye.y-world.y)/max(.1,distanceToEye));
        opacity=mix(opacity,.035+.18*exp(-1.35*path),wet);
        radiance=mix(radiance,toLinear(vec3(.055,.14,.15)),wet);
      }
      gl_FragColor=vec4(displayColor(mix(toLinear(distanceHaze),radiance,exp(-distanceToEye*.00048))),opacity);
    }`;
  function program(vertex,fragment){
    const shaders=[[gl.VERTEX_SHADER,vertex],[gl.FRAGMENT_SHADER,fragment]].map(([type,source])=>{
      const shader=gl.createShader(type);
      // GLSL ES 3 exposes fragment derivatives in core; keep ES 1 for older devices.
      if(gl2){
        const fragmentStage=type===gl.FRAGMENT_SHADER;
        source=source.replace(/\battribute\b/g,"in").replace(/\bvarying\b/g,fragmentStage?"in":"out")
          .replace(/\btexture(?:2D|Cube)\b/g,"texture").replace(/\bgl_FragColor\b/g,"frameColor");
        source="#version 300 es\n"+(fragmentStage?"out highp vec4 frameColor;\n":"")+source;
      }
      gl.shaderSource(shader,source);gl.compileShader(shader);
      if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(shader));
      return shader;
    });
    const result=gl.createProgram();
    shaders.forEach(shader=>gl.attachShader(result,shader));
    gl.linkProgram(result);
    shaders.forEach(shader=>gl.deleteShader(shader));
    if(!gl.getProgramParameter(result,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(result));
    return result;
  }
  const effectsVertex=`
    attribute vec3 point;
    attribute vec4 shade;
    attribute vec3 finish;
    ${sailMotion}
    uniform vec3 center,eye,forward,right,up;
    uniform vec2 lens;
    uniform float shadowPass;
    varying vec4 tint;
    void main(){
      vec3 moved=sailPoint(point,finish,shade.a);
      vec3 p=moved-center;
      if(shadowPass>.5){
        vec2 projected=p.xz-p.y*vec2(-.42,-.736)/.53;
        float height=(p.y+8.)/36.;
        gl_Position=vec4(projected/24.,1.-2.*height,1.);
        tint=vec4(height,height,height,1.);
      }else{
        vec3 mirror=vec3(moved.x,2.*center.y-moved.y,moved.z)-eye;
        float z=dot(mirror,forward);
        gl_Position=vec4(dot(mirror,right)/lens.x,dot(mirror,up)/lens.y,1.000036*z-.36,z);
        tint=vec4(shade.rgb,smoothstep(-.06,.025,p.y));
      }
    }`;
  const effectsFragment=`precision mediump float; varying vec4 tint; void main(){if(tint.a<.02)discard;gl_FragColor=tint;}`;
  const seaVertex=`attribute vec2 screen;
    varying vec2 pixel;
    uniform vec3 eye,forward,right,up;
    uniform vec2 lens;
    uniform vec4 waves[4];uniform vec3 offsets[4];uniform float clock;
    void main(){
      pixel=screen;
      vec3 ray=forward+right*screen.x*lens.x+up*screen.y*lens.y;
      float z=-eye.y/min(ray.y,-.0001);
      float h=0.;
      if(ray.y<0. && z<450.){
        vec2 p=eye.xz+ray.xz*z;
        for(int i=0;i<4;i++){
          float c=cos(dot(p,waves[i].xy)*waves[i].z+offsets[i].x*clock+offsets[i].y);
          h+=waves[i].w*(c+offsets[i].z*(2.*c*c-1.));
        }
        h*=1.-smoothstep(270.,450.,z);
      }
      float dz=max(.3,z+h*forward.y);
      gl_Position=vec4((screen*z+vec2(right.y/lens.x,up.y/lens.y)*h)/dz,0.,1.);
    }`;
  let sky,objects,effects;
  try{
    if(gl){
    sky=program(seaVertex,skyFragment);
    objects=program(objectVertex,(gl2?"#define PBR\n":"")+objectFragment);
    effects=program(effectsVertex,effectsFragment);
    }
  }catch(error){
    console.warn("Vista 3D indisponível",error);
    return null;
  }
  // A compact, linear HDR environment. Rebuild only when the weather changes.
  const marineLight=gl2 && gl.createTexture();
  let marineWeather=null;
  function updateMarineLight(weather){
    weather=weather||"clear";
    if(marineWeather===weather)return;
    const size=32,target=gl.TEXTURE_CUBE_MAP;
    const sun=weather==="rain"?.12:weather==="cloudy"?.40:1;
    gl.activeTexture(gl.TEXTURE8);gl.bindTexture(target,marineLight);
    for(let face=0;face<6;face++){
      const pixels=new Float32Array(size*size*4);
      for(let y=0;y<size;y++)for(let x=0;x<size;x++){
        const u=(2*x+1)/size-1,v=(2*y+1)/size-1;
        const directions=[[1,-v,-u],[-1,-v,u],[u,1,v],[u,-1,-v],[u,-v,1],[-u,-v,-1]];
        const [dx,h,dz]=directions[face].map(n=>n/Math.hypot(1,u,v));
        const sky=h>=0,blend=Math.min(1,Math.abs(h)*(sky?1.5:4));
        const pole=sky?[.26,.49,.91]:[.038,.115,.14];
        const glare=Math.pow(Math.max(0,-.42*dx+.53*h-.736*dz),190)*14*sun;
        const i=(y*size+x)*4;
        for(let k=0;k<3;k++)pixels[i+k]=(.82+(pole[k]-.82)*blend)*(.63+.37*sun)+glare*(1-.09*k);
        pixels[i+3]=1;
      }
      gl.texImage2D(gl.TEXTURE_CUBE_MAP_POSITIVE_X+face,0,gl.RGBA16F,size,size,0,gl.RGBA,gl.FLOAT,pixels);
    }
    gl.texParameteri(target,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(target,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.generateMipmap(target);
    gl.activeTexture(gl.TEXTURE0);
    marineWeather=weather;
  }
  if(gl2){
    gl.useProgram(objects);
    gl.uniform1i(gl.getUniformLocation(objects,"marineLight"),8);
    updateMarineLight("clear");
  }
  const fullscreen=gl?.createBuffer(), geometry=gl?.createBuffer(), landscape=gl?.createBuffer();
  if(gl){
    gl.bindBuffer(gl.ARRAY_BUFFER,fullscreen);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
  }
  const seaGrid=gl?.createBuffer();
  const gridOffsets=[];
  if(gl){
    const verts=[];
    for(const n of [20,34,52]){
      gridOffsets.push([verts.length/2,n*n*6]);
      for(let j=0;j<n;j++)for(let i=0;i<n;i++)for(const [x,y] of [[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]])
        verts.push(2.8*(i+x)/n-1.4,2.8*(j+y)/n-1.4);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER,seaGrid);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(verts),gl.STATIC_DRAW);
  }
  // Shared, seamlessly tiling material channels. Mip levels filter distant detail.
  let marksReady=false;
  const anisotropy=gl?.getExtension("EXT_texture_filter_anisotropic");
  const grazingFilter=()=>{
    if(anisotropy)gl.texParameterf(gl.TEXTURE_2D,anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,
      Math.min(4,gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  };
  const badgeUV={ilca:[0,0,.71,.12],snipe:[1,0,.78,.12],optimist:[2,0,.39,.26],
    tp52:[3,0,.67,.112],star:[0,1,.52,.087],clubswan36:[1,1,.71,.13],soto40:[2,1,.66,.103]};
  if(gl2){
    for(const [name,unit,url,color] of [
      ["classMarks",9,"class-marks.png",[0,0,0,0]],
      ["coastGrain",10,"coast-grain.webp",[128,128,128,255]],
      ["brightwork",11,"brasil-brightwork.webp",[128,128,128,255]]]){
      const map=gl.createTexture(),img=new Image();
      const bind=()=>{gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,map);};
      bind();
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(color));
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.useProgram(objects);gl.uniform1i(gl.getUniformLocation(objects,name),unit);
      gl.activeTexture(gl.TEXTURE0);
      img.onload=()=>{
        bind();gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
        grazingFilter();gl.activeTexture(gl.TEXTURE0);
        if(name==="classMarks")marksReady=true;
      };
      img.src=url;
    }
  }
  const detailTexture=gl?.createTexture();
  let detailPixels=null;
  const detailImage=new Image();
  if(gl){
    gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,detailTexture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([128,128,128,128]));
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    for(const prog of [objects,sky]){
      gl.useProgram(prog);gl.uniform1i(gl.getUniformLocation(prog,"detailMap"),2);
    }
    gl.activeTexture(gl.TEXTURE0);
  }
  detailImage.onload=()=>{
    if(gl){
      gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,detailTexture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,detailImage);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
      gl.activeTexture(gl.TEXTURE0);
    }else{
      const tile=document.createElement("canvas");tile.width=tile.height=256;
      const ctx=tile.getContext("2d");ctx.drawImage(detailImage,0,0);
      detailPixels=ctx.getImageData(0,0,256,256).data;
    }
  };
  detailImage.src="surface-detail.png";
  if(gl){
    const materials=gl.createTexture(),tile=new Image();
    const bindMaterials=()=>{
      gl.activeTexture(gl.TEXTURE5);
      gl.bindTexture(gl.TEXTURE_2D,materials);
    };
    bindMaterials();
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,1,1,0,gl.RGB,gl.UNSIGNED_BYTE,new Uint8Array([128,128,128]));
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    for(const program of [objects,sky]){
      gl.useProgram(program);
      gl.uniform1i(gl.getUniformLocation(program,"marineMap"),5);
    }
    gl.activeTexture(gl.TEXTURE0);
    tile.onload=()=>{
      bindMaterials();
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,tile);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
      grazingFilter();gl.activeTexture(gl.TEXTURE0);
    };
    tile.src="marine-materials.png";
  }
  if(gl){
    const cloth=gl.createTexture(), atlas=new Image();
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D,cloth);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([144,200,128,255]));
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.useProgram(objects);gl.uniform1i(gl.getUniformLocation(objects,"sailCloth"),6);
    gl.activeTexture(gl.TEXTURE0);
    atlas.onload=()=>{
      gl.activeTexture(gl.TEXTURE6);gl.bindTexture(gl.TEXTURE_2D,cloth);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,atlas);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
      grazingFilter();gl.activeTexture(gl.TEXTURE0);
    };
    atlas.src="soto-cloth.png?v=5";
  }
  if(gl2){
    const response=gl.createTexture(),image=new Image();
    function bindResponse(){gl.activeTexture(gl.TEXTURE7);gl.bindTexture(gl.TEXTURE_2D,response);}
    bindResponse();
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([128,128,182,248]));
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.useProgram(objects);gl.uniform1i(gl.getUniformLocation(objects,"responseMap"),7);
    gl.activeTexture(gl.TEXTURE0);
    image.onload=()=>{bindResponse();gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
      gl.generateMipmap(gl.TEXTURE_2D);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
      gl.activeTexture(gl.TEXTURE0);};
    image.src="material-response.png";
  }
  const crestTexture=gl?.createTexture();
  const emblem=new Image();
  if(gl){
    gl.bindTexture(gl.TEXTURE_2D,crestTexture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([240,240,219,255]));
    emblem.onload=()=>{
      gl.bindTexture(gl.TEXTURE_2D,crestTexture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,emblem);
      gl.generateMipmap(gl.TEXTURE_2D);
    };
  }
  emblem.src="cir-escudo.png";
  const lookups=new Map();
  const lookup=(program,key,attribute=false)=>{
    const id=(program===sky?"sky":program===effects?"effects":"object")+":"+key;
    if(!lookups.has(id))lookups.set(id,attribute?gl.getAttribLocation(program,key):gl.getUniformLocation(program,key));
    return lookups.get(id);
  };
  function materialQuad(a,b,c,d,color,opacity,kind,uv){
    const offset=mesh.length+7;
    quad(a,b,c,d,color,false,opacity);
    [0,1,2,0,2,3].forEach((vertex,i)=>{
      const index=offset+i*10;
      mesh[index]=uv[vertex][0];
      mesh[index+1]=uv[vertex][1];
      mesh[index+2]=kind;
    });
  }
  const add=(a,b)=>a.map((v,i)=>v+b[i]);
  const sub=(a,b)=>a.map((v,i)=>v-b[i]);
  const scale=(a,f)=>a.map(v=>v*f);
  const norm=a=>scale(a,1/(Math.hypot(...a)||1));
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const dot3=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);
  const daylight=norm([-.42,.53,-.736]);
  const white=[.91,.93,.88], deck=[.69,.74,.70], graphite=[.08,.13,.14], orange=[.99,.36,.13];
  let mesh=[];
  function triangle(a,b,c,color,light=true,opacity=1){
    const normal=norm(cross(sub(b,a),sub(c,a)));
    const diffuse=Math.abs(dot3(daylight,normal));
    const shade=light?color.map((v,i)=>v*(1-Number(light)*[.47,.42,.37][i]*(1-diffuse))):color;
    for(const point of [a,b,c])mesh.push(...point,...shade,opacity,0,0,0);
  }
  function quad(a,b,c,d,color,light,opacity){
    triangle(a,b,c,color,light,opacity);triangle(a,c,d,color,light,opacity);
  }
  function rod(a,b,r,color,round=false){
    const axis=norm(sub(b,a));
    const side=scale(norm(cross(axis,Math.abs(axis[1])>.9?[1,0,0]:[0,1,0])),r), fore=cross(axis,side);
    const edges=round?Array.from({length:8},(_,i)=>add(scale(side,Math.cos(i*Math.PI/4)),scale(fore,Math.sin(i*Math.PI/4)))):
      [side,fore,scale(side,-1),scale(fore,-1)];
    edges.forEach((v,i)=>{const next=edges[(i+1)%edges.length];quad(add(a,v),add(b,v),add(b,next),add(a,next),color);});
  }
  function box(x,y,z,w,h,d,color){
    const a=[x,y,z],b=[x+w,y,z],c=[x+w,y,z+d],e=[x,y,z+d];
    const v=[0,h,0];
    quad(a,b,add(b,v),add(a,v),color);quad(b,c,add(c,v),add(b,v),color);
    quad(c,e,add(e,v),add(c,v),color);quad(e,a,add(a,v),add(e,v),color);
    quad(add(a,v),add(b,v),add(c,v),add(e,v),color);
  }
  let landscapeCount=0, landscapeMesh, landscapeVenue;
  const cableway=[[-610,220,3660],[118,395,3555]];
  const sand=[.75,.70,.55], shoreStone=[.48,.46,.40], forest=[.19,.34,.23];
  function terrainQuad(a,b,c,d,color,kind,frequency=.13){
    if(!gl){quad(a,b,c,d,color);return;}
    const normal=norm(cross(sub(b,a),sub(c,a)));
    const shade=.74+.26*Math.abs(dot3(normal,daylight));
    const uv=[a,b,c,d].map(([x,y,z])=>[(Math.abs(normal[0])>.65?z:x)*frequency,
      (Math.abs(normal[1])>.58?z:y)*frequency]);
    materialQuad(a,b,c,d,scale(color,shade),1,kind,uv);
  }
  function roof(x,y,z,w,d,rise,paint,gable){
    const left=[x,y,z],right=[x+w,y,z],back=[x,y,z+d],far=[x+w,y,z+d];
    const a=[x,y+rise,z+d*.5],b=[x+w,y+rise,z+d*.5];
    terrainQuad(left,right,b,a,paint,10,.85);
    terrainQuad(back,far,b,a,paint,10,.85);
    triangle(left,back,a,gable);
    triangle(right,far,b,gable);
  }
  function coastSurface(polygon,color){
    const signedArea=polygon.reduce((area,[x,z],i)=>{
      const [nx,nz]=polygon[(i+1)%polygon.length];
      return area+x*nz-z*nx;
    },0);
    const outline=signedArea>0?polygon.slice():polygon.slice().reverse();
    const turn=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    for(let i=0;outline.length>2;){
      const n=outline.length, a=outline[(i+n-1)%n], b=outline[i], c=outline[(i+1)%n];
      if(turn(a,b,c)>0&&!outline.some(p=>p!==a&&p!==b&&p!==c&&turn(a,b,p)>0&&turn(b,c,p)>0&&turn(c,a,p)>0)){
        const [u,v,w]=[a,b,c].map(([x,z])=>[x,1.2,z]);
        terrainQuad(u,v,w,w,color,9);
        outline.splice(i,1);
        i=0;
      }else if(++i===n)break;
    }
  }
  function makeLandscape(coast,scenery){
    // All landmarks use the same local east/south frame as the tactical chart.
    const hash=(i,j)=>{const v=Math.sin(i*127.1+j*311.7)*43758.5453;return v-Math.floor(v);};
    function hill(x,z,rx,rz,height,seed,granite=false){
      const rings=gl?(granite?18:13):8, sectors=gl?(granite?64:48):32;
      const point=(ring,k)=>{
        const t=ring/rings,a=k*2*Math.PI/sectors;
        const edge=1+.10*Math.sin(3*a+seed)+.07*Math.cos(5*a-seed)+.035*Math.sin(9*a+seed);
        const xx=Math.cos(a)*rx*t*edge,zz=Math.sin(a)*rz*t*edge;
        const shape=Math.max(0,1-t**(granite?3.05:1.70))**(granite?.66:1.28);
        const folds=(granite?.16:.39)*t*(.52*Math.sin(4*a+2*t+seed)+.34*Math.cos(7*a-4*t+seed)+.14*Math.sin(15*a+6*t));
        // Tributary gullies split the foothills while leaving the landmark summit fixed.
        const flank=Math.sin(Math.PI*t);
        const drainage=Math.abs(Math.sin(4*a+2.1*t+seed+.38*Math.sin(7*a-3*t)));
        const relief=granite?.045*Math.cos(3*a+seed):.19*(drainage-.48)+.064*Math.sin(9*a-5*t+seed);
        return [x+xx,1+height*shape*(1+folds+flank*relief),z+zz];
      };
      const points=Array.from({length:rings+1},(_,n)=>Array.from({length:sectors},(_,k)=>point(n,k)));
      const at=(n,k)=>points[n][(k+sectors)%sectors];
      const lightAt=(n,k)=>{
        if(!n)return .91;
        const radial=sub(at(Math.min(rings,n+1),k),at(n-1,k));
        const tangent=sub(at(n,k+1),at(n,k-1));
        const normal=norm(cross(tangent,radial));
        return .52+.29*(.5+.5*normal[1])+.32*Math.max(0,dot3(daylight,normal));
      };
      for(let n=1;n<=rings;n++)for(let j=0;j<sectors;j++){
        const corners=[at(n-1,j),at(n,j),at(n,j+1),at(n-1,j+1)];
        const angle=j*2*Math.PI/sectors;
        const rock=granite && (((Math.cos(angle)>.24 || Math.sin(angle)<-.15) && n>3&&n<rings-1) ||
          (Math.sin(angle*3+seed)>.55&&n>rings*.54&&n<rings-1));
        const leaf=rock?[.50,.48,.44]:forest;
        {
          const base=mesh.length;
          const brightness=[lightAt(n-1,j),lightAt(n,j),lightAt(n,j+1),lightAt(n-1,j+1)];
          materialQuad(...corners,leaf,1,rock?8:6,corners.map(p=>rock?
            [(p[0]+p[2]*.34)*.10,p[1]*.12]:[p[0]*.032,p[2]*.032]));
          [0,1,2,0,2,3].forEach((corner,i)=>{
            const shade=base+i*10+3;
            for(let channel=0;channel<3;channel++)mesh[shade+channel]*=brightness[corner];
          });
        }
      }
    }
    function trees(x,z,h,seed){
      const crown=y=>[x+(hash(seed,8)-.5)*h*.23,y,z];
      rod([x,1.4,z],crown(h*.68),h*.038,[.37,.30,.22]);
      const branches=gl?7:4;
      for(let j=0;j<branches;j++){
        const a=j*2.399+seed, r=h*(.24+hash(seed,j)*.22);
        const y=h*(.48+hash(seed,j+7)*.29),dx=Math.cos(a)*r,dz=Math.sin(a)*r;
        const c=[x+dx,y,z+dz],tip=crown(h*1.12),bottom=crown(h*.46);
        const offset=[-dz*.45,0,dx*.45],leaf=scale(forest,.79+hash(j,seed)*.5);
        quad(tip,add(c,offset),bottom,sub(c,offset),leaf);
      }
    }
    function palm(x,z,h,seed){
      const across=(hash(seed,43)-.5)*h*.31;
      const root=[x,1.8,z],bend=[x+across*.46,h*.61,z],crown=[x+across,h,z];
      rod(root,bend,.21,[.40,.34,.25]);rod(bend,crown,.16,[.47,.40,.30]);
      for(let i=0;i<9;i++){
        const a=i*Math.PI*2/9+seed,dx=Math.cos(a),dz=Math.sin(a);
        const length=h*(.31+.19*hash(seed,i)),r=[dx,0,dz],w=[-dz,0,dx];
        const ridge=add(add(crown,scale(r,length*.49)),[0,length*.28,0]);
        const tip=add(add(crown,scale(r,length)),[0,-length*.24,0]);
        const spread=scale(w,length*.085);
        const leaf=[.12+hash(i,seed)*.065,.28+hash(seed,i)*.12,.13];
        triangle(crown,add(ridge,spread),ridge,leaf);
        triangle(crown,ridge,sub(ridge,spread),scale(leaf,.87));
        triangle(tip,ridge,add(ridge,spread),scale(leaf,.92));
        triangle(tip,sub(ridge,spread),ridge,leaf);
      }
    }
    function boulder(x,y,z,r,seed){
      const ring=(lift,radius,offset)=>Array.from({length:6},(_,i)=>{
        const a=i*Math.PI/3+offset+seed, spread=r*radius*(.77+hash(seed,i)*.47);
        return [x+Math.cos(a)*spread,y+lift*r,z+Math.sin(a)*spread*.81];
      });
      const base=ring(0,1,0),middle=ring(.43,.93,.18),top=ring(.79,.38,.32);
      const peak=[x+r*.07,y+r*.87,z-r*.14];
      for(let i=0;i<6;i++){
        const j=(i+1)%6,stone=scale(shoreStone,.78+.34*hash(i,seed));
        terrainQuad(base[i],base[j],middle[j],middle[i],scale(stone,.75),8,.28);
        terrainQuad(middle[i],middle[j],top[j],top[i],stone,8,.28);
        triangle(top[i],top[j],peak,stone);
      }
    }
    function swash(x,z,xx,zz,seaward,seed){
      const length=Math.hypot(xx-x,zz-z), count=Math.ceil(length/28);
      const offshore=(t,depth)=>[x+(xx-x)*t+seaward[0]*depth,.12,z+(zz-z)*t+seaward[1]*depth];
      for(let i=0;i<count;i++){
        const a=i/count,b=(i+1)/count,near=1+hash(seed,i)*1.2,far=near+5+hash(i,seed)*7;
        materialQuad(offshore(a,near),offshore(b,near),offshore(b,far),offshore(a,far),[.78,.87,.84],.66,11,
          [[length*a*.18,0],[length*b*.18,0],[length*b*.18,1],[length*a*.18,1]]);
      }
    }
    function spire(x,y,z,w,height,paint){
      const a=[x-w*.5,y,z-w*.5],b=[x+w*.5,y,z-w*.5],c=[x+w*.5,y,z+w*.5],d=[x-w*.5,y,z+w*.5];
      const peak=[x,y+height,z];
      triangle(a,b,peak,paint);triangle(b,c,peak,paint);triangle(c,d,peak,paint);triangle(d,a,peak,paint);
    }
    function sailingMarina(x,z){
      const dock=[.53,.51,.43],canvasWhite=[.81,.85,.80];
      box(x-18,1.1,z,232,.72,4,dock);
      for(let row=0;row<5;row++){
        const left=x+row*43;
        box(left,1.15,z,3,.62,81,dock);
        for(let berth=0;berth<8;berth++){
          const px=left+(berth%2?7:-6),pz=z+12+Math.floor(berth/2)*17;
          const n=8+hash(row,berth)*5,deck=1.05;
          const bow=[px,deck+.25,pz+n], sternL=[px-1.45,deck,pz],sternR=[px+1.45,deck,pz];
          const port=[px-1.51,deck,pz+n*.64],starboard=[px+1.51,deck,pz+n*.64];
          triangle(sternL,port,bow,canvasWhite);triangle(sternL,bow,starboard,canvasWhite);triangle(sternL,starboard,sternR,canvasWhite);
          quad(sternL,sternR,[px+1.2,.18,pz],[px-1.2,.18,pz],canvasWhite);
          box(px-.72,deck,pz+n*.21,1.44,.5,n*.33,[.65,.72,.69]);
          rod([px,deck,pz+n*.59],[px,deck+n*1.25,pz+n*.59],.058,canvasWhite);
        }
      }
    }
    if(scenery!=="santos"){
      const stone=[.45,.46,.39],cream=[.93,.88,.73],tile=[.53,.22,.12];
      for(const polygon of coast){
        coastSurface(polygon,scenery==="canas"?forest:[.31,.39,.32]);
        for(let j=1;j<polygon.length;j++){
          const [x,z]=polygon[j-1],[xx,zz]=polygon[j];
          terrainQuad([x,-1.5,z],[xx,-1.5,zz],[xx,1.2,zz],[x,1.2,z],stone,8,.22);
        }
      }
      if(scenery==="canas"){
        hill(1390,650,710,940,465,30);
        hill(1870,-570,850,750,550,32);
        hill(925,471,370,445,162,19);
        hill(1160,1050,510,640,305,26);
        hill(2150,1510,1120,1410,633,52);
        hill(2320,-1240,940,840,467,34);
        hill(-2100,-1240,900,1420,510,35);
        hill(-3000,-380,870,1320,398,83);
        const headland=coast[0];
        for(let j=8;j<headland.length-1;j++){
          const [x,z]=headland[j],[nx,nz]=headland[j+1];
          const count=Math.max(2,Math.round(Math.hypot(nx-x,nz-z)/14));
          for(let k=0;k<count;k++){
            const t=(k+hash(k,j)*.7)/count,seed=j*57+k;
            const px=x+(nx-x)*t,pz=z+(nz-z)*t;
            boulder(px-2-hash(seed,11)*4,-.48,pz,3.5+hash(seed,34)*6.1,seed);
            boulder(px+4+hash(seed,3)*11,.2,pz+3,2.8+hash(seed,27)*5,seed+240);
          }
        }
        // Place the farolete just above the coastal wall, with the house inland.
        terrainQuad([436,-1,88],[475,-1,81],[484,3.5,103],[446,3.5,122],shoreStone,8,.32);
        box(448,2.5,101,11,2.8,10,stone);
        box(450,5.3,103,7,15,6.8,cream);
        box(448.8,20.3,101.8,9.4,.46,9.2,cream);
        box(450.9,20.76,104,4.9,3.2,4.8,[.38,.49,.48]);
        roof(450.4,23.96,103.5,6,5.8,1.05,cream,cream);
        for(let j=0;j<4;j++)for(const z of [102,110.7])
          box(449.1+j*2.7,20.77,z,.17,1.15,.17,[.29,.35,.32]);
        for(const h of [8,14])box(449.94,h,105,.1,2.8,1.2,[.24,.29,.27]);

        box(519,1.4,107,53,2.2,30,stone);
        box(521,3.6,111,49,8.4,23,cream);
        roof(519,12,109,53,28,5.9,tile,cream);
        box(519,4,106.6,52,.42,5.5,stone);
        terrainQuad([519,9.4,106],[571,9.4,106],[571,11.25,113],[519,11.25,113],tile,10,.85);
        for(let bay=0;bay<7;bay++){
          const x=523+bay*6.6;
          box(x,4.4,107,.39,5,.42,cream);
          box(x+1.7,5.8,110.88,2.2,3.1,.15,[.24,.34,.28]);
          box(x+2.74,5.8,110.75,.15,3.1,.12,cream);
        }
        // The end wall and veranda face sailors approaching from the channel.
        for(const z of [114,122,129]){
          box(520.83,6.1,z,.18,3.2,2.2,[.13,.23,.19]);
          for(const side of [-1,1])box(520.64,6.05,z+side*1.15,.19,3.3,1.02,[.23,.38,.29]);
          box(520.52,5.83,z-.28,.48,.24,2.9,cream);
        }
        for(const level of [21.34,21.95]){
          rod([448.95,level,102],[457.98,level,102],.068,cream);
          rod([448.95,level,102],[448.95,level,110.7],.068,cream);
        }
        for(const z of [104.2,106.25,108.45])box(450.76,20.9,z,.2,2.96,.16,cream);
        for(let j=0;j<38;j++){
          const x=478+j*4.6,z=114+j*.89+3*Math.sin(j*.48), y=1.65+hash(j,5)*.65;
          terrainQuad([x,.1,z],[x+4.8,.1,z+.9],[x+4.8,y+1,z+.9],[x,y+1,z],shoreStone,8,.72);
        }
        for(let j=0;j<(gl?145:32);j++){
          const x=478+hash(j,32)*335,z=178+hash(j,12)*528;
          if(x<474+(z-165)*1.1)continue;
          trees(x,z,5+hash(j,24)*10,j);
        }
        for(let j=0;j<20;j++){
          const x=499+j*7.8,z=164+13*Math.sin(j*.73)+hash(j,8)*16;
          palm(x,z,7+hash(j,7)*5,j);
        }
        for(let j=0;j<6;j++)box(505+j*.14,1.5+j*.22,118+j*1.35,4.8,.3,4.7-j*.66,stone);
        for(let j=0;j<11;j++){
          const z=108+j*.91;
          rod([447.8,20.82,z],[447.8,21.83,z],.045,cream);
        }
        rod([447.8,21.83,108],[447.8,21.83,117.1],.048,cream);
      }else{
        // The parallel runway layout and orientation follow the Santos Dumont aerodrome.
        const airportStart=mesh.length, airportX=-520, airportZ=-245;
        box(airportX-194,-.8,airportZ-724,346,4.1,1448,[.47,.49,.39]);
        const runways=[[-54,1323,42],[54,1260,30]];
        for(const [offset,length,width] of runways){
          const x=airportX+offset-width*.5,z=airportZ-length*.5;
          terrainQuad([x,3.36,z],[x+width,3.36,z],[x+width,3.36,z+length],[x,3.36,z+length],[.24,.25,.25],9,.22);
          for(const edge of [1,width-1.5])box(x+edge,3.39,z,.5,.07,length,cream);
          for(let j=0;j<22;j++)box(x+width*.5-.5,3.41,z+83+j*(length-165)/22,1,.07,21,cream);
          for(const end of [z+14,z+length-40])
            for(let j=0;j<8;j++)box(x+2+j*(width-4)/8,3.41,end,1.25,.07,25,cream);
        }
        box(airportX-177,3.31,airportZ-554,61,.2,1108,[.42,.43,.40]);
        for(const gate of [-478,-238,55,271])
          box(airportX-125,3.35,airportZ+gate,71,.13,26,[.39,.41,.38]);
        box(airportX-274,3.3,airportZ-225,111,10,126,[.77,.76,.69]);
        box(airportX-273,13.3,airportZ-225,113,3.3,126,[.63,.65,.58]);
        const glassX=airportX-162;
        materialQuad([glassX,5,airportZ-225],[glassX,5,airportZ-99],
          [glassX,12.7,airportZ-99],[glassX,12.7,airportZ-225],[.23,.39,.45],1,7,[[0,0],[29,0],[29,1],[0,1]]);
        for(let j=0;j<4;j++)box(glassX,6.8,airportZ-215+j*30,23,2.7,3.3,[.60,.63,.61]);
        box(airportX-232,3.4,airportZ-86,12,26,12,stone);
        box(airportX-233,29.4,airportZ-87,14,4.5,14,[.24,.39,.44]);
        // Parked aircraft are part of the static apron mesh.
        for(const offset of [-187,-128]){
          const ax=glassX+34,az=airportZ+offset;
          const point=(x,y,z)=>[ax+x,3.55+y,az+z];
          const body=[.91,.92,.89],navy=[.15,.26,.38];
          const sections=[[-15,.21,2.65],[-11,1.32,2.25],[-6,1.52,2.2],[8,1.53,2.2],[12,1.16,2.12],[15,.10,1.91]];
          const ring=([x,r,h],angle)=>point(x,h+r*Math.sin(angle),r*Math.cos(angle));
          for(let j=1;j<sections.length;j++)for(let k=0;k<8;k++){
            const a=k*Math.PI/4,b=a+Math.PI/4;
            quad(ring(sections[j-1],a),ring(sections[j],a),ring(sections[j],b),ring(sections[j-1],b),body);
          }
          triangle(point(-13,3,0),point(-15,8,0),point(-7,3.1,0),navy);
          for(const side of [-1,1]){
            quad(point(3,2,0),point(-3,2,side*13),point(-5,2.18,side*13),point(-3,2,0),body);
            triangle(point(-10,3,0),point(-14,3.6,side*5),point(-14,3,0),body);
            rod(point(.1,1.45,side*5.1),point(3.7,1.45,side*5.1),.82,navy);
            for(let j=0;j<10;j++)box(ax-6+j*1.45,6.25,az+side*1.40,.68,.40,.13,navy);
          }
        }
        const angle=20*Math.PI/180, c=Math.cos(angle), q=Math.sin(angle);
        for(let i=airportStart;i<mesh.length;i+=10){
          const x=mesh[i]-airportX,z=mesh[i+2]-airportZ;
          mesh[i]=airportX+c*x-q*z;mesh[i+2]=airportZ+q*x+c*z;
        }

        hill(-1250,3470,535,280,116,36);
        hill(-610,3660,355,285,220,17,true);
        hill(118,3555,238,198,393,28,true);
        hill(-248,3636,385,180,51,44);
        hill(-1370,4140,540,415,226,45);
        hill(3130,2230,395,630,235,31);
        hill(3990,3260,760,690,326,24);
        hill(-2710,4200,1130,670,420,42);
        hill(-2950,3500,1020,990,347,43);
        hill(-3900,4400,1100,1350,552,44);
        // Corcovado skyline and the Flamengo waterfront.
        hill(-5190,5820,870,850,681,46,true);
        const statueX=-5190,statueZ=5820;
        box(statueX-6,680,statueZ-5,12,8,10,stone);
        box(statueX-3.5,688,statueZ-2.2,7,26,4.4,cream);
        box(statueX-13.5,707,statueZ-2.5,27,4.4,5,cream);
        box(statueX-2,714,statueZ-2,4,4,4,cream);
        sailingMarina(-1240,1020);
        box(-1450,1.2,1150,130,5,34,[.77,.76,.67]);
        box(-1447,5.9,1146,136,1,40,[.60,.65,.63]);
        for(let j=0;j<12;j++)box(-1439+j*9.4,2,1184,5.7,2.7,.22,[.20,.34,.39]);
        const promenade=[[-1460,1970],[-1680,2460],[-2040,2890],[-1670,3100],[-1245,3195]];
        for(let i=0;i<promenade.length-1;i++){
          const [x,z]=promenade[i],[nx,nz]=promenade[i+1];
          terrainQuad([x,1.6,z],[nx,1.6,nz],[nx-40,1.62,nz],[x-40,1.62,z],sand,9);
          for(let j=0;j<14;j++){
            const t=(j+.5)/14;
            const px=x+(nx-x)*t-46-hash(i,j)*31,pz=z+(nz-z)*t;
            if(j%3)trees(px,pz,6+hash(j,i)*8,j+i*31);
            else palm(px,pz,7+hash(j,i)*7,j+i*31);
          }
        }
        for(const [x,y,z] of cableway){
          box(x-16,y-9,z-11,32,12,22,cream);
          box(x-17,y+2.7,z-12,34,1.35,24,stone);
          for(let j=0;j<7;j++)box(x-14+j*4.2,y-4,z-11.08,2.75,4,.13,[.25,.36,.41]);
        }
        for(const offset of [-3,3]){
          const [a,b]=cableway.map(p=>[p[0]+offset,p[1]+2,p[2]-offset]);
          const low=add(scale(add(a,b),.5),[0,-11,0]);
          rod(a,low,.42,[.16,.21,.21]);rod(low,b,.42,[.16,.21,.21]);
        }
        for(let j=0;j<(gl?125:40);j++){
          const row=j%3,along=Math.floor(j/3), x=-1280-row*153-hash(j,3)*89,z=-1310+along*59;
          const h=18+hash(j,2)**1.6*(z<250?132:69),w=24+hash(j,5)*22,d=30+hash(j,7)*12;
          const wall=[.61+hash(j,1)*.23,.66,.65];
          box(x,2,z,w,h,d,wall);
          box(x+w*.29,h+2,z+d*.24,w*.4,3,d*.5,wall);
          for(let y=7;y<h-2;y+=7){
            materialQuad([x+w+.08,y,z+2],[x+w+.08,y,z+d-2],[x+w+.08,y+2.8,z+d-2],
              [x+w+.08,y+2.8,z+2],[.29,.40,.44],1,7,[[0,0],[8,0],[8,1],[0,1]]);
          }
        }
      }
    }else{
    // Serra do Mar behind the coastal plain, São Vicente massif to the west,
    // Santo Amaro slopes across the channel to the east.
    for(let i=0;i<8;i++)hill(-6200+i*1680,-3690-230*Math.cos(i),1850,790,360+hash(i,8)*290,i);
    hill(-2550,-2040,960,735,205,16);
    hill(-3230,-1250,735,490,173,19);
    hill(4100,-480,920,1360,285,22);
    hill(3900,1210,630,930,210,27);
    hill(-2330,-1010,240,185,90,30);
    hill(-1710,-1020,124,92,39,38);

    for(const [index,outline] of coast.entries()){
      const chain=index===0?outline.slice(3):index===1?outline.slice(3,-1):outline.slice(1,-1);
      for(let i=1;i<chain.length;i++){
        const [x,z]=chain[i-1],[xx,zz]=chain[i];
        const dx=xx-x,dz=zz-z,len=Math.hypot(dx,dz);
        const inland=index===0?[0,0,-1]:index===1?[1,0,0]:[-1,0,0];
        const a=[x,.4,z],b=[xx,.4,zz];
        const back=(p,meters,h)=>add(add(p,scale(inland,meters)),[0,h,0]);
        terrainQuad(a,b,back(b,48,2),back(a,48,2),index===0?sand:shoreStone,index===0?9:8);
        terrainQuad(back(a,48,2),back(b,48,2),back(b,1100,4),back(a,1100,4),[.32,.43,.32],6,.045);
        if(index!==0||x< -1960||x>2550)continue;
        if(x<1740&&gl)swash(x,z,xx,zz,[0,1],i);
        for(let row=0;row<2;row++){
          const count=Math.max(1,Math.floor(len/(row?47:34)));
          for(let j=0;j<count;j++){
            const seed=i*139+j*3+row, t=(j+.52)/count;
            const bx=x+dx*t,bz=z+dz*t-75-row*102-hash(seed,1)*18;
            const w=15+hash(seed,2)*14,d=18+hash(seed,3)*12;
            const h=23+hash(seed,4)*(row?83:57);
            const facade=[[.86,.82,.71],[.76,.79,.78],[.82,.77,.72],[.67,.76,.76]][seed%4];
            if(!row&&Math.abs(bx-515)<27)continue;
            box(bx,3,bz,w,h,d,facade);
            if(!row&&seed%3===1){
              for(let y=5;y<h;y+=3.4)
                box(bx+w*.025,y,bz+d,w*.95,.23,1.85,[.67,.69,.68]);
            }
            box(bx+w*.26,h+3,bz+d*.14,w*.51,4,d*.5,[.67,.69,.65]);
            const front=bz+d+.12;
            if(row===0 && seed%3===0){
              const canopy=[.36,.51,.52];
              box(bx+w*.08,5,front,w*.84,.4,1.55,canopy);
              for(const fraction of [.12,.52,.86]){
                const column=bx+w*fraction;
                box(column,2.8,front+.36,.34,2.5,.38,[.69,.72,.69]);
              }
            }
            if(!row && seed%3!==0){
              for(const fraction of [.30,.66]){
                const x=bx+w*fraction;
                quad([x,4,front+.1],[x+.58,4,front+.1],[x+.58,h,front+.1],[x,h,front+.1],[.85,.84,.79],false);
              }
              for(let y=10;y<h-2;y+=12)
                box(bx+w*.06,y,front,w*.85,.54,1.3,[.79,.78,.73]);
            }
            for(let y=9;y<h+1;y+=gl?5.8:11.6){
              const left=bx+w*.09,right=bx+w*(seed%3===0?.61:.91);
              const glazing=[[left,y,front],[right,y,front],[right,y+2.4,front],[left,y+2.4,front]];
              if(gl){
                const panes=Math.max(2,Math.round((right-left)/3.1));
                materialQuad(...glazing,[.27,.38,.42],1,7,[[0,0],[panes,0],[panes,.96],[0,.96]]);
              }else quad(...glazing,[.38,.49,.51],false);
              if(gl&&!row){
                const division=left+(right-left)*(.32+.26*hash(seed,y));
                quad([division,y,front+.02],[division+.34,y,front+.02],
                  [division+.34,y+2.4,front+.02],[division,y+2.4,front+.02],facade,false);
              }
            }
          }
        }
      }
    }
    // Channel-facing battery, upper barracks and chapel on the Guarujá headland.
    const stone=[.59,.55,.45],lime=[.88,.82,.65],tile=[.56,.27,.15];
    hill(2810,-748,144,94,35,47);
    box(2670,.25,-790,56,5.2,69,stone);
    terrainQuad([2669,.3,-790],[2669,.3,-721],[2669,5.45,-721],[2669,5.45,-790],stone,8,.62);
    box(2669,5.45,-790,2.8,1.4,69,lime);
    for(let i=0;i<9;i++)box(2668,6.7,-788+i*8,3,1.3,4,stone);
    box(2690,5,-785,14,9,54,lime);
    for(const side of [-1,1]){
      const edge=2697+side*8;
      quad([edge,14,-786],[edge,14,-730],[2697,18,-730],[2697,18,-786],tile,false);
    }
    for(let j=0;j<9;j++)box(2689.8,8,-783+j*6,.25,4,2,[.27,.32,.29]);
    box(2690,5,-799,12,14,13,lime);
    triangle([2689.8,19,-800],[2689.8,23,-793],[2689.8,19,-786],lime);
    // Promenade, gardens and light standards follow the actual curve of the game coast.
    for(let j=5;j<17;j++){
      const [x,z]=coast[0][j],[xx,zz]=coast[0][j+1];
      const strip=(a,b,h,c,kind)=>terrainQuad([x,h,z-a],[xx,h,zz-a],[xx,h,zz-b],[x,h,z-b],c,kind,.21);
      strip(9,15,2.9,[.79,.76,.68],9);strip(16,34,3,[.29,.46,.26],6);
      strip(35,38,3,[.56,.28,.23],9);strip(38,56,3,[.36,.37,.36],9);
      const count=Math.max(3,Math.floor(Math.hypot(xx-x,zz-z)/32));
      for(let k=0;k<count;k++){
        const t=(k+.55)/count,px=x+(xx-x)*t,pz=z+(zz-z)*t-22,seed=j*76+k;
        if(k%3)palm(px,pz,6+hash(seed,7)*5,seed);
        else trees(px,pz-2,7+hash(seed,8)*4,seed);
        if(k%5===0){
          box(px+7,2.91,pz+3,5.3,.92,.58,[.49,.42,.32]);
          box(px+7,3.75,pz+2.5,5.3,.13,1.2,[.51,.43,.31]);
        }
      }
      for(let k=0;k<6;k++){
        const t=(k+.5)/6,px=x+(xx-x)*t,pz=z+(zz-z)*t-14;
        rod([px,2,pz],[px,8,pz],.19,[.50,.55,.54]);
        box(px-.55,8,pz-.4,1.1,.45,.8,lime);
      }
    }
    // Deck do Pescador, modelled on piles at the edge of the schematic waterfront.
    const pierX=2025,pierZ=-1304,concrete=[.64,.65,.61],rail=[.78,.83,.80];
    box(pierX-4,3,pierZ,8,1.1,35,concrete);
    box(pierX-13,3,pierZ+29,26,1.1,6,concrete);
    for(const x of [pierX-10,pierX+3]){
      box(x,3.95,pierZ+2,7,3.05,8,[.85,.80,.69]);
      box(x-.35,7,pierZ+1.6,7.7,.25,8.7,[.47,.47,.41]);
    }
    for(const side of [-1,1]){
      for(let k=0;k<8;k++){
        const x=pierX+side*3.8,z=pierZ+k*4.4;
        box(x-.3,-1,z, .6,6.5,.6,concrete);
      }
      rod([pierX+side*3.8,5.4,pierZ],[pierX+side*3.8,5.4,pierZ+29],.15,rail);
    }
    for(let k=0;k<7;k++)box(pierX-12+k*4,-1,pierZ+35,.5,6.5,.5,concrete);
    rod([pierX-13,5.4,pierZ+35],[pierX+13,5.4,pierZ+35],.17,rail);
    // Dark fenders, the intermediate rail and tide staining give the deck a readable waterline.
    for(let k=0;k<7;k++){
      const x=pierX-12+k*4;
      box(x-.13,-.48,pierZ+35.22,.81,1.72,.65,[.27,.31,.27]);
      box(x-.18,1.45,pierZ+35.48,.87,2.35,.44,[.23,.22,.19]);
    }
    rod([pierX-13,4.76,pierZ+35],[pierX+13,4.76,pierZ+35],.085,rail);
    for(const side of [-1,1]){
      rod([pierX+side*3.8,4.76,pierZ],[pierX+side*3.8,4.76,pierZ+29],.075,rail);
    }
    const museumX=pierX-26,museumZ=pierZ-43;
    box(museumX,3,museumZ,53,12,24,lime);
    roof(museumX-1,15,museumZ-1,55,26,7,tile,lime);
    for(const x of [museumX+1,museumX+43]){
      box(x,3,museumZ+15,10,17,11,lime);
      roof(x-.7,20,museumZ+14.3,11.4,12.4,5,tile,lime);
    }
    for(let j=0;j<8;j++){
      const x=museumX+3+j*6.7,z=museumZ+26.03;
      for(const y of [6,11]){
        box(x-.38,y-.36,z,2.67,3.86,.16,[.78,.74,.64]);
        box(x,y,z+.18,1.88,3.1,.16,[.26,.39,.40]);
        box(x+.84,y,z+.35,.18,3.1,.1,lime);
      }
    }
    for(let j=0;j<52;j++){
      const x=1380+j*20,z=-1458+185*Math.sin(j/52*Math.PI);
      const h=6+hash(j,3)*4;
      rod([x,2,z],[x+.45,h,z],.34,[.39,.32,.23]);
      for(let k=0;k<7;k++){
        const a=k*.898+j,dx=Math.cos(a),dz=Math.sin(a);
        triangle([x,h+.7,z],[x+dx*2-dz*.8,h+1.5,z+dz*2+dx*.8],
          [x+dx*4.2,h-.6,z+dz*4.2],[.17,.36+hash(j,k)*.08,.21]);
      }
    }
    // Gothic silhouette and waterfront details at Embaré.
    const churchX=514,churchZ=-1763;
    const plaster=[.75,.69,.60],trim=[.59,.53,.45],slate=[.27,.30,.30];
    box(churchX-17,3,churchZ-31,34,19,49,plaster);
    roof(churchX-18,22,churchZ-32,36,51,9,slate,plaster);
    for(const side of [-1,1]){
      const x=churchX+side*12;
      box(x-4,3,churchZ+10,8,29,10,plaster);
      for(const y of [14,23,31])box(x-4.6,y,churchZ+9.6,9.2,.38,11,trim);
      spire(x,32,churchZ+15,8.4,13,slate);
      rod([x,45,churchZ+15],[x,47,churchZ+15],.12,trim);
      for(const y of [9,19,26]){
        box(x-1.2,y,churchZ+20.03,2.4,3.35,.12,[.20,.24,.23]);
        triangle([x-1.2,y+3.35,churchZ+20.16],[x+1.2,y+3.35,churchZ+20.16],[x,y+5.1,churchZ+20.16],[.20,.24,.23],false);
      }
    }
    triangle([churchX-8,22,churchZ+18.1],[churchX+8,22,churchZ+18.1],[churchX,29,churchZ+18.1],plaster);
    box(churchX-1.8,3,churchZ+18.17,3.6,6,.14,[.25,.21,.18]);
    for(let j=0;j<11;j++){
      const x=1640+j*23,z=-1380-j*1.1;
      box(x-4,2.5,z,8,1.4,6,[.66,.66,.59]);
      box(x-4.8,3.9,z-.8,9.6,.28,7.6,[.72,.78,.75]);
    }
    for(let j=0;j<26;j++){
      const z=-880+j*7;
      boulder(2700+Math.sin(j*.65)*23,-.69,z,3.5+hash(j,21)*4,j+220);
    }
    // The José Menino outfall projects into the bay, east of Urubuqueçaba.
    const tip=[-1480,3,-1060];
    box(tip[0]-26,-1,-1450,52,4,390,[.54,.55,.49]);
    box(tip[0]-48,0,tip[2]-58,96,3,68,[.56,.58,.52]);
    const ribbon=(t,side)=>{
      const a=t*Math.PI*1.82;
      return [tip[0]+8*Math.cos(a)+side*1.1,tip[1]+15*t+side*.7,tip[2]+4*Math.sin(a)+side*.55];
    };
    for(let j=0;j<20;j++)quad(ribbon(j/20,-1),ribbon(j/20,1),
      ribbon((j+1)/20,1),ribbon((j+1)/20,-1),[.86,.14,.075],false);
    }
    if(gl){
      gl.bindBuffer(gl.ARRAY_BUFFER,landscape);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(mesh),gl.STATIC_DRAW);
    }else landscapeMesh=new Float32Array(mesh);
    landscapeCount=mesh.length/10;
    mesh=[];
  }

  // The station profiles describe the two different hull forms, in metres
  // except for the longitudinal position and half-breadth (fractions).
  const dinghies={
    ...classicDesigns,
    brasil40:{length:12.192,beam:3.06,top:15.83,mast:1.47,
      // z, half-breadth, sheer, canoe-body bottom, cockpit half-opening.
      stations:[[-6.096,.59,.99,.91,0],[-5.58,.82,.96,.50,0],[-4.20,1.12,.92,0,0],
        [-4.12,1.14,.92,-.04,.51],[-3.0,1.37,.90,-.47,.60],[-1.94,1.48,.91,-.62,.62],
        [-1.86,1.49,.91,-.64,0],[-.25,1.53,.96,-.66,0],[1.45,1.42,1.04,-.55,0],
        [3.15,1.02,1.14,-.33,0],[4.22,.69,1.22,0,0],[5.35,.32,1.35,.55,0],[6.096,.012,1.46,1.44,0]]},
    tp52:{length:15.85,beam:4.42,top:23.3,mast:.78,
      stations:[[-7.925,1.85,1.04,1.49],[-6.2,2.07,1.06,1.57],[-3.4,2.21,1.10,1.56],[-1.1,2.16,1.14,1.48],
      [-.5,2.09,1.18,0],[1.5,1.91,1.19,0],[3.8,1.56,1.22,0],[6,.96,1.24,0],[7.5,.34,1.26,0],[7.925,.02,1.27,0]]},
    clubswan36:{length:11,beam:3.60,top:17.55,mast:.62,
      stations:[[-5.5,1.38,.83,1.19],[-4.45,1.64,.87,1.29],[-3.2,1.77,.91,1.30],[-1.65,1.80,.94,1.13],
        [-.89,1.77,.95,.96],[-.69,1.75,.96,0],[.75,1.64,.96,0],[2.3,1.42,.96,0],[3.72,1.05,.94,0],
        [4.72,.68,.92,0],[5.27,.32,.90,0],[5.4,.025,.88,0]]},
    soto40:{length:12.34,beam:3.79,top:19.19,mast:.99,
      stations:[[-6.17,1.78,.94,1.49],[-4.8,1.85,.96,1.42],[-2.65,1.895,.98,1.27],[-.80,1.83,1.02,1.15],
      [-.22,1.78,1.04,0],[1.48,1.59,1.05,0],[3.22,1.20,1.06,0],[4.9,.59,1.07,0],[6.17,.014,1.08,0]]},
    optimist:{
      length:2.30,beam:1.13,mast:.67,top:2.62,boom:.66,foot:1.94,
      mainWidths:[[0,1.94],[.45,1.66],[1,1.08]],
      stations:[[-.5,.80,.29,-.03,.84],[-.27,.95,.30,-.115,.89],[0,1,.32,-.14,.88],[.25,.93,.35,-.10,.84],[.5,.73,.39,.01,.79]]
    },
    ilca:{
      length:4.23,beam:1.37,mast:.81,top:6.19,boom:.96,foot:2.71,
      mainWidths:[[0,2.71],[.23,2.31],[.47,1.73],[.71,.96],[.91,.31],[1,.065]],
      stations:[[-.5,.73,.252,-.005,0],[-.40,.846,.266,-.075,0],[-.355,.90,.275,-.12,0],[-.343,.904,.278,-.125,.38],[-.32,.925,.285,-.142,.52],
        [-.23,.978,.315,-.187,.55],[-.08,1,.342,-.219,.55],[.036,.986,.354,-.216,.52],
        [.078,.973,.365,-.209,.49],[.095,.961,.368,-.203,.38],[.111,.950,.372,-.197,0],[.24,.823,.412,-.148,0],
        [.35,.609,.455,-.077,0],[.44,.348,.479,.026,0],[.484,.131,.490,.133,0],[.5,0,.493,.217,0]]
    },
    star:{
      length:6.922,beam:1.734,mast:1.02,top:9.65,boom:1.03,foot:4.445,
      mainWidths:[[0,4.445],[.22,3.69],[.47,2.62],[.70,1.64],[.89,.74],[1,.08]],
      // Approximate hard-chine sections, long ends and an open cockpit.
      stations:[[-.5,.57,.42,.12,0,.36,.22],[-.35,.75,.39,-.045,0,.51,.065],
        [-.27,.87,.385,-.13,0,.6,-.019],[-.258,.89,.382,-.148,.54,.61,-.035],
        [-.16,.98,.381,-.226,.68,.66,-.068],[0,1,.40,-.23,.68,.686,-.092],
        [.028,.998,.414,-.227,.50,.68,-.088],[.034,.996,.416,-.225,0,.68,-.086],
        [.14,.91,.432,-.18,0,.60,-.047],[.27,.69,.46,-.045,0,.42,.08],
        [.39,.38,.50,.115,0,.20,.20],[.46,.15,.52,.23,0,.069,.28],[.5,0,.535,.35,0,0,.35]]
    },
    snipe:{
      length:4.724,beam:1.524,mast:.45,top:6.23,boom:1.24,foot:2.78,
      mainWidths:[[0,2.78],[.24,2.18],[.48,1.61],[.73,.86],[.92,.31],[1,.10]],
      // SCIRA 2026 measurement handbook, hull plan and side elevation.
      // Aft to forward: distance, sheer/chine breadth, sheer/chine/keel elevations (mm).
      offsets:[[0,1035,959,578,318,172],[788,1283,1143,546,248,114],
        [1575,1486,1276,546,206,64],[2362,1524,1238,553,203,57],
        [3149,1359,997,581,229,95],[3936,908,533,635,286,162],[4724,0,0,678,400,330]],
      opening:[[-.5,0],[-.445,0],[-.432,.57],[-.31,.64],[-.1,.66],[.04,.65],
        [.073,.58],[.081,.30],[.087,0],[.5,0]]

    }
  };
  function interpolateProfile(rows,column,z){
    const end=rows.length-1;
    const i=Math.max(0,Math.min(end-1,rows.findIndex(row=>row[0]>z)-1));
    if(z<=rows[0][0])return rows[0][column];
    if(z>=rows[end][0])return rows[end][column];
    const left=rows[i],right=rows[i+1],before=rows[Math.max(0,i-1)],after=rows[Math.min(end,i+2)];
    const spacing=right[0]-left[0], t=(z-left[0])/spacing;
    const l=left[column],r=right[column];
    const dl=(r-before[column])*spacing/(right[0]-before[0]);
    const dr=(after[column]-l)*spacing/(after[0]-left[0]);
    const value=(2*t**3-3*t*t+1)*l+(t**3-2*t*t+t)*dl+(-2*t**3+3*t*t)*r+(t**3-t*t)*dr;
    return Math.min(Math.max(l,r),Math.max(Math.min(l,r),value));
  }
  for(const design of Object.values(dinghies)){
    if(design.offsets){
      const offsets=design.offsets.map(([at,...values])=>[at/4724-.5,...values]);
      const positions=[...new Set([...offsets,...design.opening].map(row=>row[0]))].sort((a,b)=>a-b);
      design.stations=positions.map(z=>[z,interpolateProfile(offsets,1,z)/1524,
        interpolateProfile(offsets,3,z)/1000-.15,interpolateProfile(offsets,5,z)/1000-.15,
        interpolateProfile(design.opening,1,z),interpolateProfile(offsets,2,z)/2000,
        interpolateProfile(offsets,4,z)/1000-.15]);
    }
    design.sections=design.stations.flatMap((station,i)=>{
      const next=design.stations[i+1];
      if(!next)return [station];
      const mid=(station[0]+next[0])*.5;
      return [station,[mid,...station.slice(1).map((_,index)=>index+1).map(column=>interpolateProfile(design.stations,column,mid))]];
    });
  }
  const sparAlloy=[.70,.75,.78];
  function model(boat,state){
    const {boatClass,oceanTime,course:{water}}=state;
    const isSnipe=boatClass==="snipe",isStar=boatClass==="star",hasJib=isSnipe||isStar;
    const opti=boatClass==="optimist";
    const design=dinghies[boatClass];
    const {length,beam,sections:stations}=design;
    const {pitch,heel:roll,heave:height}=boat;
    const sin=Math.sin(boat.h),cos=Math.cos(boat.h);
    const rollCos=Math.cos(roll),rollSin=Math.sin(roll);
    function local([x,y,z]){
      const xx=x*rollCos-y*rollSin;
      const yy=x*rollSin+y*rollCos;
      return [boat.x+xx*cos+z*sin,height+yy+pitch*z,boat.y+xx*sin-z*cos];
    }
    function panel(a,b,c,d,color,light){
      const start=mesh.length;
      quad(local(a),local(b),local(c),local(d),color,light);
      if(gl2 && color.varnish)for(const [i,v] of [a,b,c,a,c,d].entries()){
        const j=start+10*i;
        mesh[j+7]=v[1]+.21*v[0];mesh[j+8]=v[2]*.45;mesh[j+9]=1.43;
      }
    }
    function textured(a,b,c,d,color,light,kind){
      const start=mesh.length;
      if(kind>=20 && !gl2)kind=16;
      panel(a,b,c,d,color,gl2 && (kind===1||kind>=15)?false:light);
      let offset=start+7;
      for(const v of [a,b,c,a,c,d]){
        if(kind===17 && !gl2){
          const nx=v[5]*rollCos-v[6]*rollSin,ny=v[5]*rollSin+v[6]*rollCos;
          const sun=(nx*cos+v[7]*sin)*daylight[0]+ny*daylight[1]+(nx*sin-v[7]*cos)*daylight[2];
          const glow=.76+.22*Math.abs(sun);
          for(let k=0;k<3;k++)mesh[offset-4+k]=color[k]*glow+.045*Math.abs(sun);
        }
        mesh[offset]=kind>=16||kind===2.25?v[3]:(kind===1||kind===1.30||kind===15)?v[0]:Math.hypot(v[0],v[2]-design.mast);
        mesh[offset+1]=kind>=16||kind===2.25?v[4]:(kind===1||kind===1.30||kind===15)?v[2]:v[1];
        if(kind>=20){
          const sheet=kind<21?boat.mainSail:boat.jibSail;
          mesh[offset-1]=boat.h-(sheet.angle||0);
        }
        mesh[offset+2]=(kind===17 && boatClass==="brasil40")?17.25:kind; offset+=10;
      }
    }
    // Clip exterior plating at the local moving waterline; keep the recessed cockpit dry.
    const wetVertices=new Map();
    function hullVertex(p){
      if(!wetVertices.has(p)){
        const v=local(p);
        wetVertices.set(p,{v,uv:[p[2]+.48*p[0],p[1]+.35*Math.abs(p[0])],h:v[1]-waterSample(water,v[0],v[2],oceanTime).height});
      }
      return wetVertices.get(p);
    }
    function hullPanel(a,b,c,d,color){
      const corners=(c===d?[a,b,c]:[a,b,c,d]).map(hullVertex), above=[];
      let prev=corners[corners.length-1];
      for(const next of corners){
        if((prev.h>0)!==(next.h>0)){
          const t=prev.h/(prev.h-next.h);
          above.push({v:add(prev.v,scale(sub(next.v,prev.v),t)),h:0,
            uv:prev.uv.map((value,i)=>value+t*(next.uv[i]-value))});
        }
        if(next.h>=0)above.push(next);
        prev=next;
      }
      for(let k=2;k<above.length;k++){
        const a=above[0],b=above[k-1],c=above[k];
        const offset=mesh.length;
        triangle(a.v,b.v,c.v,color,!gl2);
        if(gl2)for(let j=offset;j<mesh.length;j+=10){mesh[j+7]=mesh[j]*.14;mesh[j+8]=mesh[j+1]*.14;mesh[j+9]=-1;}
        if(gl2 && boatClass==="tp52"){
          [a,b,c].forEach(({uv,h},i)=>{
            const j=offset+i*10;
            mesh[j+7]=uv[0];mesh[j+8]=uv[1];mesh[j+9]=-3-.5*Math.max(0,1-h/.24);
          });
        }
        // Reflect the broad sky and the water bounce on polished gelcoat.
        if(!gl2 && !boat.i && camera){
          const center=scale(add(add(a.v,b.v),c.v),1/3);
          const view=norm(sub(camera.eye,center));
          let n=norm(cross(sub(b.v,a.v),sub(c.v,a.v)));
          if(dot3(n,view)<0)n=scale(n,-1);
          const facing=cap(dot3(view,n));
          const reflectedY=2*facing*n[1]-view[1];
          const sheen=.05+.31*(1-facing)**3;
          const tint=reflectedY>0?[.78,.86,.92]:[.22,.44,.48];
          const spec=Math.max(0,dot3(n,norm(add(view,daylight))))**36;
          for(let j=0;j<3;j++)for(let k=0;k<3;k++){
            const at=offset+j*10+3+k;
            mesh[at]=mesh[at]*(1-sheen)+tint[k]*sheen+spec*.18;
          }
        }
        if(!boat.i || a.h+b.h+c.h<.42){
          [a,b,c].forEach(({h},i)=>{
            const wet=Math.max(0,1-h/.18)*.38,base=offset+i*10+3;
            mesh[base]*=1-wet;
            mesh[base+1]*=1-wet*.72;
            mesh[base+2]=mesh[base+2]*(1-wet*.55)+wet*.045;
          });
        }
      }
    }
    function tube(a,b,r,color){
      const start=mesh.length;
      const origin=local(a),end=local(b);
      rod(origin,end,r,color,!boat.i && gl2 && r>=.032);
      if(r<=.018){for(let j=start+9;j<mesh.length;j+=10)mesh[j]=-.35;return;}
      if(gl2 && color.varnish){
        const axis=norm(sub(end,origin));
        const crossgrain=norm(cross(axis,Math.abs(axis[1])>.9?[cos,0,sin]:[0,1,0]));
        for(let j=start;j<mesh.length;j+=10){
          const v=[mesh[j]-origin[0],mesh[j+1]-origin[1],mesh[j+2]-origin[2]];
          mesh[j+7]=dot3(v,crossgrain)*2.7;mesh[j+8]=dot3(v,axis)*.45;mesh[j+9]=1.43;
        }
        return;
      }
      if(gl2 && (color===sparAlloy||color.bronze)){
        for(let i=start;i<mesh.length;i+=10){mesh[i+7]=mesh[i];mesh[i+8]=mesh[i+1];mesh[i+9]=-2;}
        return;
      }
      if(color!==sparAlloy || boat.i)return;
      // Broad metallic highlights follow the spar, including rotation of the boom.
      for(let i=start;i<mesh.length;i+=30){
        const p=mesh.slice(i,i+3),q=mesh.slice(i+10,i+13),v=mesh.slice(i+20,i+23);
        const n=norm(cross(sub(q,p),sub(v,p))),view=norm(sub(camera.eye,p));
        const flash=Math.abs(dot3(n,norm(add(view,daylight))))**10;
        for(let j=i;j<i+30;j+=10)for(let k=0;k<3;k++)mesh[j+3+k]=mesh[j+3+k]*.89+flash*.32;
      }
    }
    if(classicDesigns[boatClass]){
      if(!boat.i)casterStart=mesh.length/10;
      drawVintageSloop(boat,design,panel,hullPanel,tube,textured,oceanTime,sparAlloy,rounded);
      return;
    }
    if(boatClass==="brasil40"){
      if(!boat.i)casterStart=mesh.length/10;
      drawBrasil40(boat,design,panel,hullPanel,tube,textured,oceanTime,sparAlloy,rounded);
      return;
    }
    if(boatClass==="tp52"){
      if(!boat.i)casterStart=mesh.length/10;
      drawTP52(boat,design,panel,hullPanel,tube,textured,oceanTime,sparAlloy,rounded);
      return;
    }
    if(boatClass==="clubswan36"){
      if(!boat.i)casterStart=mesh.length/10;
      drawClubSwan(boat,design,panel,hullPanel,tube,textured,oceanTime,sparAlloy,rounded);
      return;
    }
    if(boatClass==="soto40"){
      if(!boat.i)casterStart=mesh.length/10;
      drawSoto40(boat,design,panel,hullPanel,tube,textured,oceanTime,sparAlloy,rounded);
      return;
    }
    const accent=[1,3,5].map(start=>parseInt(boat.color.slice(start,start+2),16)/255);
    const gelcoat=isSnipe?[.92,.938,.915]:[.966,.962,.934];
    const cockpitColor=isSnipe?[.66,.71,.70]:[.71,.746,.72];
    const hullColor=isSnipe?[.92,.939,.914]:[.949,.955,.936];
    const sole=isStar?.06:isSnipe?.102:.145;
    function section([z,b,sheer,keel,opening,chineHalf,chineY],side){
      const half=beam*b*.5, x=side*half, at=z*length;
      const depth=sheer-keel;
      const crown=isSnipe?.056:.021;
      const rim=[x*opening,sheer+crown*(1-opening*opening),at];
      const floor=opening?[x*opening*.85,sole,at]:rim;
      const outer=[x,sheer,at];
      const toe=[x*(isSnipe?.975:.987),sheer-.024,at];
      const profile=opti?[outer,toe,[x*.86,keel+.018,at],[0,keel,at]]:hasJib?
        [outer,toe,[side*chineHalf,chineY,at],
          [side*chineHalf*.53,keel+(chineY-keel)*.41,at],[0,keel,at]]:
        [outer,toe,[x*.97,keel+depth*.67,at],[x*.89,keel+depth*.37,at],
          [x*.70,keel+depth*.14,at],[x*.40,keel+depth*.033,at],[0,keel,at]];
      return {outer,rim,floor,profile,deck:[x*(.56+.44*opening),sheer+crown*.45,at]};
    }
    for(const side of [-1,1]){
      const sections=stations.map(station=>section(station,side));
      for(let i=1;i<sections.length;i++){
        const a=sections[i-1],b=sections[i];
        for(let j=1;j<a.profile.length;j++){
          const band=j===1?(hasJib?(boat.i?accent:[.20,.35,.44]):[.80,.82,.80]):hullColor;
          hullPanel(a.profile[j-1],b.profile[j-1],b.profile[j],a.profile[j],band);
        }
        textured(a.outer,b.outer,b.deck,a.deck,gelcoat,true,1);
        textured(a.deck,b.deck,b.rim,a.rim,[.85,.87,.85],true,1);
        if(!boat.i && a.rim[0]*b.rim[0]!==0){
          tube(a.rim,b.rim,.012,gelcoat);
        }
        panel(a.rim,b.rim,b.floor,a.floor,cockpitColor);
        textured(a.floor,b.floor,[0,b.floor[1],b.floor[2]],[0,a.floor[1],a.floor[2]],
          stations[i-1][4]||stations[i][4]?cockpitColor:gelcoat,true,1);
        if(hasJib&&stations[i][4]&&stations[i-1][4]){
          panel(a.rim,b.rim,add(b.rim,[0,.022,0]),add(a.rim,[0,.022,0]),[.80,.84,.81]);
        }
      }
    }
    const transom=stations[0], aft=-length/2;
    const sternShape=section(transom,1).profile;
    for(let i=1;i<sternShape.length;i++){
      const a=sternShape[i-1],b=sternShape[i];
      hullPanel([-a[0],a[1],aft],a,b,[-b[0],b[1],aft],gelcoat);
    }
    if(opti){
      const bow=section(stations.at(-1),1).profile;
      for(let j=1;j<bow.length;j++){
        const a=bow[j-1],b=bow[j];
        hullPanel(a,[-a[0],a[1],a[2]],[-b[0],b[1],b[2]],b,gelcoat);
      }
    }
    if(!boat.i){
      const steel=[.67,.71,.72], rubber=[.16,.19,.20];
      for(const side of [-1,1]){
        const x=side*(opti?.30:isSnipe?.43:.38);
        tube([x,sole+.025,-length*.28],[x,sole+.026,-length*.09],.015,rubber);
        for(const z of [-length*.28,-length*.09])
          tube([x-.023,sole+.028,z],[x+.023,sole+.028,z],.012,steel);
      }
      tube([-.035,transom[2]-.12,aft-.018],[.035,transom[2]-.12,aft-.018],.021,steel);
    }
    const drain=isSnipe?[.24,.30,.29]:[.39,.42,.40];
    tube([0,transom[2]*.43,aft-.006],[0,transom[2]*.43,aft-.018],.021,drain);
    const boardZ=isSnipe?.16:.09;
    const boardTop=isSnipe?.42:.36;
    const trunk=[.34,.39,.37];
    if(isStar){
      tube([-.62,.43,-.46],[.62,.43,-.46],.025,graphite);
      tube([0,.16,design.mast],[0,.45,design.mast],.046,graphite);
    }else{
      panel([-.07,sole,boardZ-.33],[-.07,boardTop,boardZ-.33],[-.07,boardTop,boardZ+.21],[-.07,sole,boardZ+.21],trunk);
      panel([.07,sole,boardZ-.33],[.07,boardTop,boardZ-.33],[.07,boardTop,boardZ+.21],[.07,sole,boardZ+.21],trunk);
      tube([0,boardTop+.014,boardZ-.30],[0,boardTop+.014,boardZ+.19],.029,graphite);
      if(isSnipe){
        // Raised central case of the DB-R1, with a moulded top and tapered aft end.
        const half=.145,front=.28,back=-.83;
        for(const side of [-1,1]){
          const x=half*side;
          panel([x,sole,back-.10],[x,sole,front],[x,boardTop,front],[x,boardTop-.055,back],gelcoat);
          panel([0,boardTop-.055,back],[x,boardTop-.055,back],[x,boardTop,front],[0,boardTop,front],gelcoat);
          panel([0,sole,back-.10],[x,sole,back-.10],[x,boardTop-.055,back],[0,boardTop-.055,back],gelcoat);
        }
      }else{
        // Deck leads for the independent Cunningham and outhaul purchase.
        for(const side of [-1,1]){
          const foot=[side*.046,.45,design.mast], guide=[side*.063,.407,.67],cleat=[side*.072,.39,.49];
          tube(foot,guide,.006,side<0?[.23,.43,.62]:[.62,.30,.19]);
          tube(guide,cleat,.006,side<0?[.23,.43,.62]:[.62,.30,.19]);
          tube(add(cleat,[-.014,0,0]),add(cleat,[.014,0,0]),.017,graphite);
        }
      }
    }
    const strapEnd=isStar?-1.72:isSnipe?-1.73:opti?-.93:-1.30;
    for(const offset of isStar?[-.25,.25]:hasJib?[-.16,.16]:[0]){
      let last;
      for(let k=0;k<=8;k++){
        const t=k/8,z=strapEnd+(boardZ-.30-strapEnd)*t;
        const y=sole+.023+.095*Math.sin(Math.PI*t);
        const pair=[[offset-.043,y,z],[offset+.043,y,z]];
        if(last)panel(last[0],last[1],pair[1],pair[0],graphite);
        last=pair;
      }
    }
    if(!boat.i && opti){
      // Lashed side buoyancy bags, tucked against the inside of the pram hull.
      for(const side of [-1,1]){
        const x=side*.384,y=.223;
        const profile=(t,angle)=>{
          const radius=.094*Math.sin(Math.PI*t)**.38;
          return [x+radius*Math.cos(angle),y+radius*Math.sin(angle),-.84+.70*t];
        };
        for(let j=0;j<6;j++)for(let k=0;k<8;k++){
          const a=k*Math.PI/4,b=a+Math.PI/4;
          panel(profile(j/6,a),profile(j/6,b),profile((j+1)/6,b),profile((j+1)/6,a),[.77,.80,.75],.6);
        }
        for(const t of [.26,.73])for(let k=0;k<6;k++){
          const a=k*Math.PI/6,b=(k+1)*Math.PI/6;
          tube(add(profile(t,a),[0,.003,0]),add(profile(t,b),[0,.003,0]),.009,graphite);
        }
      }
    }else if(!boat.i && hasJib){
      // Recessed sheet tracks with sliding fairleads on the cockpit coamings.
      for(const side of [-1,1]){
        const z=isStar?.31:.06;
        const railPoint=dz=>{
          const t=(z+dz)/length;
          const half=interpolateProfile(stations,1,t)*beam*.5;
          const inner=interpolateProfile(stations,4,t);
          return [side*half*(.92+.08*inner),interpolateProfile(stations,2,t)+.022,z+dz];
        };
        const slide=railPoint(0);
        tube(railPoint(-.16),railPoint(.16),.014,sparAlloy);
        tube(add(slide,[0,0,-.036]),add(slide,[0,0,.036]),.023,graphite);
        tube(slide,add(slide,[0,.046,0]),.012,sparAlloy);
      }
    }
    const blockZ=isSnipe?-.47:-.51;
    tube([0,sole,blockZ],[0,sole+.18,blockZ],.043,graphite);
    if(!boat.i){
      // Stainless cheeks and axle of the cockpit mainsheet block.
      for(const side of [-1,1]){
        const x=side*.043;
        const lip=[x,sole+.19,blockZ];
        tube([x,sole+.065,blockZ-.027],lip,.012,sparAlloy);
        tube(lip,[x,sole+.065,blockZ+.027],.012,sparAlloy);
      }
      tube([-.051,sole+.146,blockZ],[.051,sole+.146,blockZ],.014,sparAlloy);
    }
    const pivot=isStar?-2.36:aft-.06;
    const rudder=[0,transom[2]-.04,pivot-.03];
    const helm=Math.max(-.56,Math.min(.56,boat.rudderAngle));
    const onRudder=([x,y,z])=>[
      x*Math.cos(helm)+(z-pivot)*Math.sin(helm),y,
      pivot+(z-pivot)*Math.cos(helm)-x*Math.sin(helm)
    ];
    // Each horizontal section follows the leading edge, both faces and the thin trailing edge.
    // Reuse the plating clipper so the foils emerge continuously as the hull rolls.
    function foil(rows,color,orient){
      const rings=rows.map(([y,leading,trailing,thickness])=>{
        const chord=leading-trailing;
        return [[0,leading],[thickness*.5,leading-chord*.16],
          [thickness*.5,leading-chord*.4],[thickness*.08,trailing],
          [-thickness*.08,trailing],[-thickness*.5,leading-chord*.4],
          [-thickness*.5,leading-chord*.16]].map(([x,z])=>orient([x,y,z]));
      });
      for(let i=1;i<rings.length;i++){
        const upper=rings[i-1],lower=rings[i];
        for(let j=0;j<lower.length;j++){
          const k=(j+1)%lower.length;
          hullPanel(upper[j],upper[k],lower[k],lower[j],color);
        }
      }
      const tip=rings[rings.length-1];
      for(let j=1;j<tip.length-1;j++)hullPanel(tip[0],tip[j],tip[j+1],tip[0],color);
    }
    const boardRoot=interpolateProfile(design.stations,3,boardZ/length);
    const span=isSnipe?.87:.79;
    const boardColor=isSnipe?[.67,.71,.73]:[.92,.93,.87];
    if(isStar){
      foil([[-.17,.72,-.55,.14],[-.42,.47,-.84,.20],[-.76,.27,-1.01,.23],
        [-.97,.14,-.87,.19],[-1.016,.06,-.67,.13]],[.19,.27,.29],p=>p);
      foil([[-.09,-2.16,-2.70,.095],[-.34,-2.29,-2.76,.085],
        [-.59,-2.44,-2.72,.063],[-.67,-2.53,-2.66,.033]],gelcoat,onRudder);
      foil([[.01,-1.99,-2.30,.082],[-.31,-2.15,-2.37,.062],[-.52,-2.29,-2.45,.039]],gelcoat,p=>p);
    }else{
      foil([[boardRoot+.045,boardZ+.18,boardZ-.23,isSnipe?.012:.026],
        [boardRoot-span*.68,boardZ+.16,boardZ-.24,isSnipe?.012:.026],
        [boardRoot-span*.94,boardZ+(isSnipe?.085:.045),boardZ-.235,.012],
        [boardRoot-span,boardZ-.015,boardZ-.205,.008]],boardColor,p=>p);
      foil([[rudder[1],aft-.09,aft-.27,.033],
        [rudder[1]-.22,aft-.085,aft-.34,.035],
        [-.53,aft-.14,aft-(isSnipe?.43:.37),.032],
        [-.65,aft-.19,aft-.34,.018],[-.68,aft-.235,aft-.29,.008]],gelcoat,onRudder);
      tube([0,transom[2]-.11,aft],[0,transom[2]+.15,aft-.07],.049,graphite);
    }
    function starPose(crew){
      const side=Math.sign(boat.crewOffset)||1;
      const hike=Math.min(1,boat.crewHike*(crew?1:.72)+(boat.extraHike||0)*(crew?.24:.17));
      const z=crew?-.51:-1.54;
      const interpolate=(a,b)=>a+(b-a)*hike;
      const seat=Math.abs(boat.crewOffset)*.86;
      const x=interpolate(seat,crew?.99:.81);
      const hips=[side*x,interpolate(.53,crew?.33:.49),z];
      const angle=hike*(crew?1.65:1.03);
      const shoulders=[side*(x+.49*Math.sin(angle)),hips[1]+.49*Math.cos(angle),z+.055];
      const knees=leg=>[side*interpolate(seat*.68,(crew?.74:.65)+leg*.045),
        interpolate(.32,.47),z+(1-hike)*.25+leg*.104];
      const ankles=leg=>[side*interpolate(seat*.46,.30),interpolate(.14,crew?.115:.13),
        z+(1-hike)*.40+leg*.108];
      const stand=crew?boat.starStand??0:0;
      if(!stand)return {side,hike,hips,shoulders,knees,ankles};
      const mix=(a,b)=>add(scale(a,1-stand),scale(b,stand));
      const fore=boat.starFore??0,lateral=boat.starSide??0;
      const stanceX=.33,stanceZ=design.mast-.16;
      const uprightHips=[stanceX+.23*lateral,1.20-.09*Math.abs(fore),stanceZ+.31*fore];
      const uprightShoulders=add(uprightHips,[.23*lateral,.47,.22*fore]);
      return {
        side,stand,hike:hike*(1-stand),hips:mix(hips,uprightHips),shoulders:mix(shoulders,uprightShoulders),
        knees:leg=>mix(knees(leg),[stanceX+leg*.12+.08*lateral,.84-.12*Math.abs(fore),stanceZ+leg*.13+.19*fore]),
        ankles:leg=>mix(ankles(leg),[stanceX+leg*.12,.50,stanceZ+leg*.16]),
        hand:(leg,seated)=>mix(seated,leg<0?[.067,1.45,design.mast-.025]:
          add(uprightShoulders,[.22+.12*lateral,-.31,.26-.1*fore])),
        elbow:(leg,seated)=>mix(seated,add(uprightShoulders,[leg*.19,-.21,.14]))
      };
    }
    const starHelm=isStar?starPose(false):null;
    const starCrew=isStar?starPose(true):null;
    const tillerTip=onRudder([0,transom[2]+.17,isStar?pivot+.79:aft+.68]);
    const grip=isStar?[starHelm.hips[0]*.83,.64,-1.44]:
      [boat.crewOffset*.75,transom[2]+.32,aft+1.13];
    tube([0,transom[2]+.10,pivot],tillerTip,.025,graphite);
    tube(tillerTip,grip,.015,graphite);
    if(!boat.i&&!hasJib&&!opti){
      const y=.42;
      for(const side of [-1,1]){
        const anchor=[side*.42,.31,aft+.12];
        tube(add(anchor,[0,-.023,-.035]),add(anchor,[0,-.023,.035]),.019,sparAlloy);
      }
      tube([-.033,y,aft+.14],[.033,y,aft+.14],.036,graphite);
      for(const side of [-1,1])tube([side*.035,y-.029,aft+.14],[side*.035,y+.034,aft+.14],.009,sparAlloy);
    }
    if(!hasJib&&!opti){
      tube([-.42,.31,aft+.12],[0,.42,aft+.14],.009,graphite);
      tube([0,.42,aft+.14],[.42,.31,aft+.12],.009,graphite);
    }
    const {angle:boomAngle,camber:mainCamber,flutter:mainFlutter}=boat.mainSail;
    const lee=boat.lee;
    const {mast:mastZ,top:mastTop,boom:boomY,foot:boomLength}=design;
    const rake=y=>isStar?mastZ-.034*(y-.42)-.21*(boat.starRig?.runner??.35)*(y/mastTop)**2:
      isSnipe?mastZ-.042*(y-.45):mastZ;
    if(!boat.i) casterStart=mesh.length/10;
    const alloy=sparAlloy;
    // Continuous tapered spar with a shared ring at every change in bend.
    const mastSides=boat.i?6:16, mastSteps=boat.i?4:12;
    const mastRadius=opti?.0225:isStar?.043:isSnipe?.033:.032;
    const sparPoint=(t,angle)=>{
      const y=.35+(mastTop-.35)*t;
      const taper=hasJib?1-.48*Math.pow(t,1.8):opti?1:1-.24*t;
      const radius=mastRadius*taper;
      return [radius*Math.cos(angle),y,rake(y)+radius*(hasJib?1.32:1)*Math.sin(angle)];
    };
    for(let j=0;j<mastSides;j++){
      const a=2*Math.PI*j/mastSides,b=2*Math.PI*(j+1)/mastSides;
      const metal=scale(alloy,.84+.16*Math.cos(a-.8));
      for(let i=0;i<mastSteps;i++)panel(sparPoint(i/mastSteps,a),sparPoint((i+1)/mastSteps,a),
        sparPoint((i+1)/mastSteps,b),sparPoint(i/mastSteps,b),metal,.72);
    }
    if(hasJib){
      const steel=[.51,.56,.58], capHeight=isStar?7.24:5.46;
      const h=isStar?4.83:3.18;
      for(const side of [-1,1]){
        const tip=[side*(isStar?.49:.425),h,rake(h)-.14];
        const chainplate=[side*(isStar?.73:.67),isStar?.42:.48,isStar?.48:.13];
        const head=[0,capHeight,rake(capHeight)];
        tube([0,h,rake(h)],tip,.014,alloy);
        tube(chainplate,tip,.004,steel);
        tube(tip,head,.0035,steel);
        if(!boat.i){
          const adjuster=add(chainplate,scale(norm(sub(tip,chainplate)),.15));
          tube(chainplate,adjuster,.013,alloy);
        }
        if(isStar){
          tube(chainplate,[0,h,rake(h)],.004,steel);
          tube(tip,[0,mastTop-.16,rake(mastTop-.16)],.0035,steel);
          const stern=[side*.47,.46,-3.25];
          const tension=side===-lee?(boat.starRig?.runner??.35):0;
          const bend=add(scale(head,.42),scale(stern,.58));
          bend[1]-=.29*(1-tension);bend[0]+=side*.16*(1-tension);
          tube(head,bend,.004,steel);tube(bend,stern,.005,steel);
        }
      }
    }
    function cloth(distance,y,depth,angle=boomAngle){
      const sin=Math.sin(angle),cos=Math.cos(angle);
      return [sin*distance+depth*cos,y,rake(y)-cos*distance+depth*sin];
    }
    tube([0,boomY,rake(boomY)],cloth(boomLength,boomY,0),opti?.021:isStar?.055:.036,alloy);
    if(!boat.i){
      const collar=cloth(.065,boomY,0);
      tube([0,boomY,rake(boomY)],collar,opti?.027:.043,graphite);
      tube(cloth(boomLength-.042,boomY,0),cloth(boomLength,boomY,0),opti?.022:isStar?.056:.037,graphite);
    }
    function mainPoint(row,col){
      const span=interpolateProfile(design.mainWidths,1,row);
      const twist=lee*row*(.05+mainFlutter*.15);
      // Keep the luff on the mast and the foot on the boom.
      const belly=lee*Math.sin(Math.PI*col**.78)*mainCamber;
      const looseCloth=Math.sin(Math.PI*col)*.55+col*.75;
      const ripple=mainFlutter*row*looseCloth*(.22*Math.sin(oceanTime*11-row*8-col*10)+
        .11*Math.sin(oceanTime*17-row*12-col*4));
      return cloth(span*col,boomY+(mastTop-boomY-.11)*row+(opti?.51*row*col:0)+Math.sin(row*Math.PI)*col*.10,
        span*(belly+ripple)*Math.sin(Math.PI*Math.pow(row,.66)),boomAngle+twist);
    }
    if(opti){
      tube([0,.94,mastZ],mainPoint(1,1),.014,alloy);
      if(!boat.i){
        // Individual sail ties around the mast and along the boom.
        for(let i=0;i<=7;i++){
          const tie=mainPoint(i/7,.012);
          tube([-.023,tie[1]+.008,mastZ+.015],tie,.0045,graphite);
          tube(tie,[.023,tie[1]-.008,mastZ+.015],.0045,graphite);
        }
        for(let i=1;i<=6;i++){
          const d=boomLength*i/7;
          tube(cloth(d,boomY-.022,.012),cloth(d,boomY+.027,-.012),.005,graphite);
        }
      }
    }
    if(!hasJib&&!opti){
      // The sleeved ILCA luff wraps around the spar from the tack to the head.
      for(let k=0;k<8;k++){
        const sleeve=(t,y)=>[Math.sin(t)*.046,y,rake(y)+Math.cos(t)*.046];
        const t=k*Math.PI/4, end=t+Math.PI/4;
        panel(sleeve(t,boomY+.035),sleeve(end,boomY+.035),
          sleeve(end,mastTop-.095),sleeve(t,mastTop-.095),[.89,.89,.855],.62);
      }
    }
    const sailBands=isSnipe?[.22,.44,.65,.84]:[.19,.39,.60,.80];
    const sailRows=boat.i?13:24,sailCols=boat.i?7:14;
    const clothRows=Array.from({length:sailRows+1},(_,i)=>
      Array.from({length:sailCols+1},(_,j)=>[...mainPoint(i/sailRows,j/sailCols),j/sailCols,i/sailRows]));
    for(let i=1;i<clothRows.length;i++){
      const lower=clothRows[i-1],upper=clothRows[i];
      const height=i/sailRows;
      const panelIndex=sailBands.filter(row=>height>row).length;
      for(let j=1;j<lower.length;j++){
        const translucence=1-.045*Math.sin(Math.PI*j/sailCols)**2-.035*(1-height)**2;
        const fabric=scale(panelIndex%2?[.954,.949,.917]:[.984,.980,.952],translucence);
        textured(lower[j-1],lower[j],upper[j],upper[j-1],fabric,.54,marksReady?2.25:2);
      }
    }
    function seam(point,a,b,width,color,steps){
      let previous=point(...a);
      for(let i=1;i<=steps;i++){
        const t=i/steps,next=point(a[0]*(1-t)+b[0]*t,a[1]*(1-t)+b[1]*t);
        tube(previous,next,width,color);
        previous=next;
      }
    }
    for(const row of sailBands)seam(mainPoint,[row,.02],[row,.99],.0034,[.82,.83,.80],7);
    for(const row of isStar?[.24,.46,.68,.87]:isSnipe?[.29,.57,.79]:opti?[.49,.78]:[.31,.56,.78]){
      seam(mainPoint,[row,.63],[row,1],.008,[.86,.87,.83],4);
    }
    seam(mainPoint,[.015,.013],[.99,.013],isSnipe?.010:.024,[.82,.84,.81],16);
    seam(mainPoint,[.013,.997],[.99,.997],.006,[.87,.87,.82],16);
    const markColor=(isSnipe||opti)?[.15,.23,.27]:[.79,.13,.11];
    function decal(side){
      return (row,col)=>{
        const p=mainPoint(row,col);
        const upward=sub(mainPoint(row+.005,col),p);
        const aftward=sub(mainPoint(row,col+.005),p);
        return add(p,scale(norm(cross(upward,aftward)),side*.013));
      };
    }
    const decalCenter=local(mainPoint(.53,.40));
    const clothNormal=cross(sub(local(mainPoint(.55,.40)),decalCenter),
      sub(local(mainPoint(.53,.42)),decalCenter));
    const visibleSide=dot3(clothNormal,sub(camera.eye,decalCenter))<0?1:-1;
    const painted=decal(visibleSide);
    if(!boat.i){
      // Layered clew reinforcement follows the camber and twist of the mainsail.
      for(const span of [.29,.20,.12]){
        const outer=painted(.012,1-span);
        const corner=painted(.012,.995);
        const upper=painted(.014+span*.54,.994);
        const tone=.82+(span/.29)*.09;
        triangle(local(outer),local(corner),local(upper),[tone,tone+.009,tone-.018],.42);
        seam(painted,[.012,1-span],[.014+span*.54,.994],.004,[.68,.71,.69],4);
      }
    }
    if(!marksReady){
      const mark=(a,b)=>seam(painted,a,b,.011,markColor,6);
      if(isStar){
        const row=.698,col=.37;
        const span=interpolateProfile(design.mainWidths,1,row);
        const vertices=Array.from({length:10},(_,i)=>{
          const angle=i*Math.PI/5,radius=i%2?.082:.203;
          return local(painted(row+Math.cos(angle)*radius/(mastTop-boomY),col+Math.sin(angle)*radius/span));
        });
        for(let i=0;i<10;i++)triangle(local(painted(row,col)),vertices[i],vertices[(i+1)%10],markColor,false);
      }else if(isSnipe){
        mark([.70,.28],[.729,.44]);mark([.729,.44],[.716,.74]);mark([.716,.74],[.737,.89]);
        mark([.716,.74],[.68,.52]);mark([.68,.52],[.67,.36]);mark([.729,.44],[.751,.52]);
      }else if(opti){
        const ring=[[.68,.50],[.69,.56],[.72,.59],[.752,.56],[.762,.50],[.752,.44],[.72,.41],[.69,.44],[.68,.50]];
        for(let i=1;i<ring.length;i++)mark(ring[i-1],ring[i]);
        mark([.72,.59],[.72,.68]);mark([.72,.68],[.67,.68]);
      }else{
        mark([.714,.47],[.714,.72]);mark([.714,.72],[.635,.51]);
        mark([.689,.35],[.643,.35]);mark([.643,.35],[.643,.45]);
      }
    }
    if(!boat.i){
      // Lightweight leech ribbons follow the boom and flutter as the sail unloads.
      for(const row of [.50,.76]){
        const root=mainPoint(row,.998);
        const direction=norm(sub(root,mainPoint(row,.90)));
        const length=opti?.12:.19,strip=[.72,.17,.12];
        let last=root;
        for(let j=1;j<=3;j++){
          const t=j/3,angle=oceanTime*(7+6*mainFlutter)+row*16-t*4;
          const tip=add(root,scale(direction,length*t));
          tip[0]+=.025*t*Math.sin(angle)*(.35+mainFlutter);
          tip[1]+=t*(-.025+.024*Math.cos(angle));
          panel(last,tip,add(tip,[0,.012*(1-.45*t),0]),add(last,[0,.012,0]),strip,false);
          last=tip;
        }
      }
      // Reinforcement layers follow the loaded sail at each corner.
      for(const [r,c,dr,dc] of [[.018,.018,.112,.25],[.018,.977,.125,-.23],[.955,.08,-.075,.50]]){
        for(const size of [1,.67,.37]){
          const detailPatch=[painted(r,c),painted(r+dr*size,c),painted(r,c+dc*size)];
          triangle(...detailPatch.map(local),[.88+.05*size,.89+.045*size,.85+.05*size],.42);
        }
      }
      const digitLines=["0,0 1,0 1,1 0,1 0,0","0,0 1,0 1,1","0,1 1,1 1,.5 0,.5 0,0 1,0",
        "0,1 1,1 1,0 0,0 1,0 1,.5 0,.5","0,1 0,.47 1,.47 1,0 1,1"];
      const number=isStar?[3,0,4,2]:isSnipe?[3,1,3,2,4]:[2,2,4,0,1,2];
      for(const [i,n] of number.entries()){
        const path=digitLines[n].split(" ").map(coords=>{
          const [x,y]=coords.split(",").map(Number);
          const chord=.14+i*.115+x*.072;
          return [.391+y*.061,visibleSide<0?.94-chord:chord];
        });
        for(let j=1;j<path.length;j++)seam(painted,path[j-1],path[j],.008,[.10,.15,.18],4);
      }
    }
    tube([0,.49,mastZ],cloth(.57,boomY,0),.015,graphite);
    if(!hasJib&&!opti){
      const traveler=[0,.42,aft+.14],sheet=[.69,.29,.18];
      tube(cloth(boomLength-.08,boomY-.04,0),traveler,.006,sheet);
      tube(traveler,cloth(boomLength-.17,boomY-.04,0),.006,sheet);
      tube(cloth(boomLength-.17,boomY-.04,0),cloth(1.05,boomY-.035,0),.006,sheet);
    }else if(opti){
      const bridle=cloth(1.08,boomY-.19,0);
      tube(cloth(.65,boomY,0),bridle,.005,graphite);
      tube(bridle,cloth(1.57,boomY,0),.005,graphite);
    }
    const helmZ=isStar?-1.54:isSnipe?-1.23:opti?-.53:-1;
    const pull=boat.pumpPull||0;
    const sheetHand=isStar?[starHelm.hips[0]+starHelm.side*.08,.65+.13*pull,helmZ+.25-.23*pull]:
      [boat.crewOffset*(.42+.39*pull),.49+.13*pull,helmZ+.43-.31*pull];
    if(starCrew?.hike>.66){
      const anchor=[starCrew.side*.56,.424,-.51];
      tube(anchor,add(starCrew.hips,[-starCrew.side*.10,.07,.03]),.013,[.22,.24,.25]);
      tube(add(anchor,[0,0,-.032]),add(anchor,[0,0,.032]),.021,alloy);
    }
    if(!boat.i){
      // Sheaves between paired cheeks at the cockpit ratchet block.
      const hub=[0,sole+.18,blockZ],metal=[.66,.70,.71];
      tube(add(hub,[-.031,0,0]),add(hub,[.031,0,0]),.042,[.23,.26,.25]);
      for(const side of [-1,1]){
        const x=side*.035;
        tube(add(hub,[x,-.043,0]),add(hub,[x,.036,.006]),.012,metal);
      }
      const lead=cloth(opti?1.08:isStar?1.60:isSnipe?1.45:1.05,boomY-(opti?.19:.032),0);
      tube(lead,hub,.008,[.63,.27,.17]);
      tube(hub,sheetHand,.009,[.63,.27,.17]);
      // The eased tail rests on the cockpit sole below the sheet hand.
      const coilX=isStar?.23:isSnipe?.15:opti?.105:.095;
      const coilZ=isStar?-.95:isSnipe?-.89:opti?-.58:-.86;
      let previous=[coilX,sole+.013,coilZ+.12];
      const bend=[(sheetHand[0]+coilX)*.5,sole+.046,coilZ+.19];
      tube(sheetHand,bend,.006,[.63,.27,.17]);tube(bend,previous,.006,[.63,.27,.17]);
      for(let k=1;k<=16;k++){
        const phase=k*Math.PI/5.5, taper=1-k*.019;
        const next=[coilX+Math.sin(phase)*.064*taper,sole+.014+.003*k/16,coilZ+.12*Math.cos(phase)*taper];
        tube(previous,next,.006,[.63,.27,.17]);previous=next;
      }
      // Clew strop, outhaul and the metal shackle follow the boom.
      const clewEnd=cloth(boomLength-.08,boomY+.055,0);
      tube(clewEnd,cloth(boomLength-.08,boomY-.038,0),.014,[.32,.37,.39]);
      tube(clewEnd,cloth(boomLength,boomY+.018,0),.007,[.85,.53,.19]);
      tube(cloth(boomLength-.38,boomY+.032,0),cloth(boomLength,boomY+.032,0),.006,[.80,.59,.23]);
      for(const x of [-.068,.068]){
        tube([x,sole+.02,blockZ-.04],[x,sole+.02,blockZ+.04],.012,metal);
      }
      for(const row of [.31,.57]){
        const root=painted(row,.19);
        const tip=painted(row+.008*Math.sin(oceanTime*6+row),.31);
        tube(root,tip,.005,[.68,.17,.13]);
      }
    }
    if(hasJib){
      const {angle:jibAngle,camber:jibCamber,flutter:jibFlutter}=boat.jibSail;
      const jibSin=Math.sin(jibAngle),jibCos=Math.cos(jibAngle);
      const tack=isStar?[0,.59,3.23]:[0,.704,2.27];
      const luffHead=isStar?7.24:5.46;
      const head=[0,luffHead,rake(luffHead)];
      const foot=isStar?(boat.pole?2.83:2.56):2;
      const base=boat.pole&&isStar?design.mast:tack[2];
      const clew=[foot*jibSin,isStar?.94:1.02,base-foot*jibCos];
      tube(tack,head,.012,graphite);
      const jibPoint=(row,col)=>{
        const a=add(scale(tack,1-row),scale(head,row));
        const b=add(scale(clew,1-row),scale(head,row));
        const p=add(scale(a,1-col),scale(b,col));
        const depth=(1-row)*(2*(boat.pole?-lee:lee)*jibCamber*Math.sin(col*Math.PI)+
          jibFlutter*col*row*.68*Math.sin(oceanTime*13-row*9-col*8));
        p[0]+=depth*jibCos;
        p[2]+=depth*jibSin;
        return p;
      };
      for(let row=0;row<10;row++)for(let col=0;col<7;col++){
        const a=row/10,b=(row+1)/10,c=col/7,d=(col+1)/7;
        textured(jibPoint(a,c),jibPoint(a,d),jibPoint(b,d),jibPoint(b,c),
          row%3===0?[.92,.94,.917]:[.97,.977,.954],.58,2);
      }
      for(const row of [.23,.46,.70])seam(jibPoint,[row,.04],[row,.98],.003,[.81,.84,.82],6);
      seam(jibPoint,[0,0],[.99,0],.008,[.83,.86,.83],12);
      seam(jibPoint,[0,1],[.99,1],.006,[.82,.85,.82],12);
      if(!boat.i){
        // Layered radial tapes fan out from the loaded jib clew.
        for(const reach of [.20,.39,.59]){
          const a=jibPoint(.013,.965), b=jibPoint(reach,.81), c=jibPoint(reach,.77);
          const lift=scale(norm(cross(sub(b,a),sub(c,a))),.006);
          for(const face of [-1,1]){
            const offset=scale(lift,face);
            triangle(...[a,b,c].map(v=>local(add(v,offset))),[.83,.86,.83],.56);
          }
        }
        const workingSide=boat.pole?-lee:lee;
        const lazyLead=[-workingSide*(isStar?.57:.49),.47,-.34];
        const mid=add(scale(clew,.52),scale(lazyLead,.48));
        mid[1]=Math.max(.48,mid[1]-.15);
        tube(clew,mid,.005,[.30,.42,.47]);tube(mid,lazyLead,.005,[.30,.42,.47]);
        for(const side of [-1,1]){
          const x=side*(isStar?.57:.49);
          tube([x,.47,-.50],[x,.47,-.20],.014,alloy);
          tube([x-.022,.50,-.34],[x+.022,.50,-.34],.022,graphite);
        }
      }
      if(boat.pole)tube([0,1.07,rake(1.07)],clew,.022,alloy);
      tube(clew,[(boat.pole?-lee:lee)*(isStar?.57:.49),.50,-.34],.009,graphite);
    }
    function rounded(center,radii,color,material=0){
      const point=(lat,lon)=>add(center,[radii[0]*Math.cos(lat)*Math.cos(lon),
        radii[1]*Math.sin(lat),radii[2]*Math.cos(lat)*Math.sin(lon)]);
      const fine=!boat.i&&gl&&radii[1]>.08;
      const rings=fine?6:4,sectors=fine?12:8;
      const grid=Array.from({length:rings+1},(_,i)=>Array.from({length:sectors},(_,j)=>{
        const lat=Math.PI*(i/rings-.5),lon=j*2*Math.PI/sectors;
        const world=local(point(lat,lon));
        // Inverse radii give the surface normal of an ellipsoid.
        const n=norm([Math.cos(lat)*Math.cos(lon)/radii[0],Math.sin(lat)/radii[1],Math.cos(lat)*Math.sin(lon)/radii[2]]);
        const nx=n[0]*rollCos-n[1]*rollSin,ny=n[0]*rollSin+n[1]*rollCos;
        const light=Math.max(0,(nx*cos+n[2]*sin)*daylight[0]+ny*daylight[1]+(nx*sin-n[2]*cos)*daylight[2]);
        const glow=.72+.26*light+.08*ny;
        return [...world,color[0]*glow,color[1]*glow,color[2]*(glow+.027*(1-light)),1,Math.cos(lat)*Math.cos(lon),Math.sin(lat),material];
      }));
      for(let i=0;i<rings;i++)for(let j=0;j<sectors;j++){
        const k=(j+1)%sectors,a=grid[i][j],b=grid[i][k],c=grid[i+1][k],d=grid[i+1][j];
        mesh.push(...a,...b,...c,...a,...c,...d);
      }
    }
    function sailor(z,color,crew){
      const effort=boat.extraHike||0;
      const side=Math.sign(boat.crewOffset)||1;
      const pose=crew?starCrew:starHelm;
      const position=pose?pose.hips[0]:boat.crewOffset+side*effort*(crew?.26:.22);
      const hike=boat.crewHike;
      const brace=boat.i?0:Math.max(-.12,Math.min(.12,boat.rollRate*.16));
      const tilt=.69*hike+effort*(1.24-.69*hike)+side*brace;
      const hips=pose?.hips??[position,.39+.045*effort,z];
      const shoulders=pose?.shoulders??[position+side*.46*Math.sin(tilt),hips[1]+.46*Math.cos(tilt),z+.12+(boat.i?0:.09*pull-.08*boat.pitch)];
      const look=boat.i?0:.14*Math.sin(boat.rudderAngle*2.2);
      const neck=[shoulders[0]+side*(pose?pose.hike*.10:hike*.06)+look*.18,
        shoulders[1]+(pose?.hike>.65?.075:.12),shoulders[2]+.05];
      const skin=[.71,.52,.39];
      tube(hips,shoulders,.135,graphite);
      rounded(add(scale(hips,.38),scale(shoulders,.62)),[.185,.215,.135],color,boat.i?0:14);
      tube(shoulders,neck,.083,[.68,.45,.30]);
      rounded(add(neck,[0,.065,0]),[.087,.115,.095],skin);
      rounded(add(neck,[0,.145,0]),[.093,.058,.103],graphite);
      rounded(add(neck,[0,.132,.080]),[.080,.012,.083],graphite);
      if(!boat.i){
        for(const ear of [-1,1]){
          rounded(add(neck,[ear*.079,.074,.006]),[.017,.027,.016],skin);
          tube(add(neck,[ear*.08,.099,.025]),add(neck,[ear*.05+look*.12,.098,.083]),.010,graphite);
        }
        tube(add(neck,[-.054,.10,.084]),add(neck,[.053,.10,.084]),.013,[.12,.18,.20]);
        const jacket=add(scale(hips,.38),scale(shoulders,.62));
        const reflective=[.75,.80,.73],webbing=[.10,.13,.15];
        const back=add(jacket,[0,.025,-.13]);
        panel(add(back,[-.084,0,0]),add(back,[.084,0,0]),add(back,[.073,.076,.008]),add(back,[-.073,.076,.008]),[.80,.27,.10]);
        tube(add(back,[-.057,.046,-.003]),add(back,[.057,.046,-.003]),.009,reflective);
        tube(add(jacket,[-.11,-.07,-.08]),add(jacket,[-.095,.11,-.10]),.010,webbing);
        for(const shoulderSide of [-1,1]){
          const x=shoulderSide*.094;
          tube(add(jacket,[x,.12,-.085]),add(jacket,[x,.045,-.131]),.019,reflective);
        }
        tube(add(jacket,[-.14,-.064,-.073]),add(jacket,[0,-.064,-.135]),.017,webbing);
        tube(add(jacket,[0,-.064,-.135]),add(jacket,[.14,-.064,-.073]),.017,webbing);
        rounded(add(neck,[0,.081,.081]),[.026,.030,.027],[.68,.46,.35]);
      }
      for(const limb of [-1,1]){
        const knee=pose?.knees(limb)??[position*.67+side*.055*effort,.37+hike*.08,z+.26+limb*.14];
        const ankle=pose?.ankles(limb)??[side*(isSnipe?.16:.035),sole+.04,z+.45+limb*.13];
        tube(hips,knee,.078,graphite);tube(knee,ankle,.057,graphite);
        const toe=pose?add(ankle,[-side*.14*pose.hike,.025*pose.hike,.11*(1-pose.hike)]):
          add(ankle,[0,-.015,.11]);
        tube(ankle,toe,.057,[.10,.15,.16]);
        const shoulder=pose?[shoulders[0],shoulders[1]+.05,shoulders[2]+limb*.13]:
          [shoulders[0]+limb*.13,shoulders[1],shoulders[2]];
        const seatedHand=crew?(pose?[position-side*.17,.59,z+.18]:[position*.3,.52,z+.42]):limb===-side?grip:sheetHand;
        const hand=pose?.hand?pose.hand(limb,seatedHand):seatedHand;
        const seatedElbow=pose?[.64*position+.36*shoulders[0]+side*.12,shoulders[1]-.065,z+.15+limb*.11]:
          [position+limb*.14,.61,z+.26-(!crew&&limb===side?.17*pull:0)];
        const elbow=pose?.elbow?pose.elbow(limb,seatedElbow):seatedElbow;
        tube(shoulder,elbow,.053,color);tube(elbow,hand,.037,[.68,.48,.32]);
        if(!boat.i){
          rounded(hand,[.040,.036,.048],[.16,.18,.17]);
          rounded(knee,[.072,.076,.080],[.18,.21,.22]);
          if(!pose)rounded([ankle[0],ankle[1],ankle[2]+.05],[.060,.055,.107],[.13,.16,.17]);
        }
      }
    }
    sailor(helmZ,boat.i?accent:[.17,.24,.28],false);
    if(hasJib)sailor(isStar?-.48:-.34,[.73,.39,.21],true);
  }

  function buoy(x,z,height,radius,color,clock){
    const y=height+Math.sin(clock*1.7+x)*.09;
    const bands=[[0,1],[.33,1],[.72,.62],[.82,.25]];
    for(let step=0;step<12;step++){
      const a=step*2*Math.PI/12,b=(step+1)*2*Math.PI/12;
      const p=([h,r],angle)=>[x+Math.cos(angle)*r*radius,y+h*radius*2,z+Math.sin(angle)*r*radius];
      for(let i=1;i<bands.length;i++)quad(p(bands[i-1],a),p(bands[i-1],b),p(bands[i],b),p(bands[i],a),i===2?color:scale(color,.78));
      triangle(p(bands.at(-1),a),p(bands.at(-1),b),[x,y+radius*1.72,z],color);
    }
  }
  function markZone(mark,state){
    if(Math.hypot(mark.x-camera.eye[0],mark.y-camera.eye[2])>190)return;
    const {course:{water},oceanTime:t,zoneRadius:radius}=state;
    const active=state.boats[0].zoneMark===mark;
    const color=active?[.68,.96,1]:[.61,.87,.91];
    const vertex=(angle,r)=>{
      const x=mark.x+Math.cos(angle)*r,z=mark.y+Math.sin(angle)*r;
      return [x,waterSample(water,x,z,t).height+.09,z];
    };
    const count=48,thickness=active?.105:.065;
    for(let i=0;i<count;i++){
      const a=i*2*Math.PI/count,b=(i+.66)*2*Math.PI/count;
      quad(vertex(a,radius-thickness),vertex(a,radius+thickness),vertex(b,radius+thickness),
        vertex(b,radius-thickness),color,false,active?.64:.38);
    }
  }
  function raceMark(p,state){
    const y=waterSample(state.course.water,p.x,p.y,state.oceanTime).height;
    const radius=.46,h=1.72,axis=Math.atan2(camera.eye[2]-p.y,camera.eye[0]-p.x);
    function skin(angle,v,r=radius){return [p.x+r*Math.cos(angle),y+v,p.y+r*Math.sin(angle)];}
    for(let j=0;j<16;j++){
      const a=j*Math.PI/8,b=a+Math.PI/8;
      for(const [lo,hi,color] of [[-.18,.12,graphite],[.12,.53,orange],[.53,1.30,[.96,.94,.82]],[1.30,h,orange]]){
        quad(skin(a,lo),skin(b,lo),skin(b,hi),skin(a,hi),color);
      }
      triangle(skin(a,h),skin(b,h),[p.x,y+h+.04,p.y],orange);
    }
    const glyphs={"1":["010","110","010","010","111"],"2":["110","001","010","100","111"],
      A:["010","101","111","101","101"],S:["111","100","111","001","111"],P:["110","101","110","100","100"]};
    const count=p.label.length*4-1;
    [...p.label].forEach((ch,i)=>glyphs[ch].forEach((row,j)=>[...row].forEach((bit,k)=>{
      if(bit==="0")return;
      const a=axis-(i*4+k-count/2)*.21,b=a-.205,top=1.22-j*.115;
      quad(skin(a,top,.474),skin(b,top,.474),skin(b,top-.113,.474),skin(a,top-.113,.474),graphite,false);
    })));
  }
  function committeeLaunch(line,isStart,state){
    const {course:{water},oceanTime:t}=state;
    const n=line.normal,star=[-n.y,n.x],p=line.committee;
    const sea=waterSample(water,p.x,p.y,t);
    // The mast is the endpoint. The centre of the hull sits outside the racing line.
    function point(x,y,z){
      const dx=(x+1.24)*star[0]+z*n.x,dz=(x+1.24)*star[1]+z*n.y;
      return [p.x+dx,sea.height+y+.65*(sea.slopeX*dx+sea.slopeZ*dz),p.y+dz];
    }
    const face=(a,b,c,d,color)=>quad(point(...a),point(...b),point(...c),point(...d),color);
    const bar=(a,b,r,color)=>rod(point(...a),point(...b),r,color);
    const navy=[.09,.19,.26],ivory=[.94,.94,.86],glass=[.22,.38,.43];
    const sections=[[-4.35,1.25,.77],[-3.3,1.54,.82],[.5,1.59,.95],[2.65,1.28,1.18],[4.35,.04,1.52]];
    for(let i=1;i<sections.length;i++){
      const [z,w,h]=sections[i-1],[zz,ww,hh]=sections[i];
      face([-w,h,z],[w,h,z],[ww,hh,zz],[-ww,hh,zz],ivory);
      for(const side of [-1,1]){
        face([side*w,h,z],[side*ww,hh,zz],[side*ww,hh-.12,zz],[side*w,h-.12,z],navy);
        face([side*w,h-.12,z],[side*ww,hh-.12,zz],[side*ww*.78,-.25,zz],[side*w*.78,-.25,z],ivory);
      }
    }
    face([-1.25,.77,-4.35],[1.25,.77,-4.35],[1,-.23,-4.35],[-1,-.23,-4.35],ivory);
    for(const side of [-1,1]){
      const x=side*1.05;
      face([x,.84,-1.4],[x,.94,1.9],[x,2.32,1.27],[x,2.32,-1.4],ivory);
      for(const z of [-1.22,-.20])face([x*1.01,1.47,z],[x*1.01,1.47,z+.88],[x*1.01,2.16,z+.88],[x*1.01,2.16,z],glass);
    }
    face([-1.05,.84,-1.4],[1.05,.84,-1.4],[1.05,2.32,-1.4],[-1.05,2.32,-1.4],ivory);
    face([-.89,1.50,-1.41],[.89,1.50,-1.41],[.89,2.15,-1.41],[-.89,2.15,-1.41],glass);
    face([-1.05,.94,1.9],[1.05,.94,1.9],[1.05,2.32,1.27],[-1.05,2.32,1.27],glass);
    face([-1.18,2.35,-1.58],[1.18,2.35,-1.58],[1.18,2.35,1.44],[-1.18,2.35,1.44],navy);
    for(const side of [-1,1]){
      for(const z of [-3.8,-2.6,-1.6]){
        bar([side*1.33,.85,z],[side*1.33,1.48,z],.027,[.71,.76,.77]);
        if(z!==-1.6)bar([side*1.33,.72,z],[side*1.4,.30,z+.07],.105,[.19,.26,.32]);
      }
      bar([side*1.33,1.48,-3.8],[side*1.33,1.48,-1.6],.032,[.71,.76,.77]);
      bar([side*1.13,1.65,2],[side*.12,1.82,4.12],.034,[.71,.76,.77]);
      bar([side*1.13,1.04,2],[side*1.13,1.65,2],.03,[.71,.76,.77]);
    }
    bar([.14,2.37,-.3],[.14,3.46,-.4],.022,[.71,.76,.77]);
    bar([-.5,2.65,.38],[.5,2.65,.38],.12,ivory);
    bar([0,2.35,.38],[0,2.65,.38],.07,ivory);
    // Wheelhouse crest plates read correctly from either side and from astern.
    const crestUv=[[0,1],[1,1],[1,0],[0,0]];
    for(const side of [-1,1]){
      const x=side*1.058,ft=-1.22*side;
      materialQuad(point(x, .99, -.28+ft*.23),point(x,.99,-.28-ft*.23),
        point(x,1.44,-.28-ft*.23),point(x,1.44,-.28+ft*.23),ivory,1,3,crestUv);
      const light=side>0?[.08,.73,.32]:[.92,.14,.12];
      bar([side*1.13,2.34,1.15],[side*1.13,2.46,1.15],.055,light);
      bar([side*.59,.82,-4.21],[side*.59,.82,-4.62],.028,navy);
      bar([side*1.23,.46,-4.28],[side*1.23,.77,-4.28],.030,navy);
    }
    materialQuad(point(.31,.95,-1.417),point(-.31,.95,-1.417),point(-.31,1.48,-1.417),
      point(.31,1.48,-1.417),ivory,1,3,crestUv);
    for(const x of [-.72,.72]){
      bar([x,.69,-4.39],[x,.30,-4.54],.18,navy);
      bar([x,.74,-4.46],[x,.62,-4.46],.20,[.22,.25,.28]);
    }
    bar([-.91,1.96,1.63],[-.29,1.37,1.925],.016,navy);
    // The official stands aft of the wheelhouse, reading the watch on the left wrist.
    const skin=[.68,.47,.34], shorts=[.26,.32,.37], shirt=[.86,.89,.88];
    const glance=.5+.5*Math.sin(t*1.5), watchHeight=2.08+.035*glance;
    function oval(center,radii,color){
      function at(ring,side){
        const lat=ring*Math.PI/4-Math.PI/2, lon=side*Math.PI/4, radius=Math.cos(lat);
        return [center[0]+radii[0]*radius*Math.cos(lon),center[1]+radii[1]*Math.sin(lat),
          center[2]+radii[2]*radius*Math.sin(lon)];
      }
      for(let ring=0;ring<4;ring++)for(let side=0;side<8;side++)
        face(at(ring,side),at(ring,side+1),at(ring+1,side+1),at(ring+1,side),color);
    }
    const x=.59,z=-2.77;
    for(const side of [-1,1]){
      const foot=x+side*.14;
      bar([foot,.92,z+.02],[foot,.92,z-.13],.066,navy);
      bar([foot,.98,z],[foot,1.32,z],.055,skin);
      bar([foot,1.32,z],[x+side*.085,1.69,z+.06],.078,shorts);
    }
    oval([x,1.86,z+.06],[.19,.27,.122],shirt);
    bar([x,2.04,z+.04],[x+.02,2.14,z+.01],.063,skin);
    const head=[x+.028,2.25-.022*glance,z-.016];
    oval(head,[.095,.117,.092],skin);
    oval([head[0],head[1]+.075,head[2]+.012],[.101,.056,.099],navy);
    face([head[0]-.096,head[1]+.07,head[2]-.018],[head[0]+.091,head[1]+.07,head[2]-.018],
      [head[0]+.064,head[1]+.039,head[2]-.18],[head[0]-.053,head[1]+.039,head[2]-.18],navy);
    for(const side of [-1,1]){
      const lens=head[0]+side*.045;
      bar([lens-.035,head[1]-.012,head[2]-.085],[lens+.035,head[1]-.012,head[2]-.085],.024,graphite);
    }
    const elbow=[x+.23,1.85,z-.09],wrist=[x+.037,watchHeight,z-.32];
    bar([x+.145,2.02,z+.029],elbow,.067,shirt);
    bar(elbow,wrist,.043,skin);
    oval([wrist[0]-.024,wrist[1]+.006,wrist[2]-.025],[.043,.035,.055],skin);
    bar([wrist[0]+.027,wrist[1]-.025,wrist[2]+.026],
      [wrist[0]+.027,wrist[1]+.033,wrist[2]+.026],.045,graphite);
    face([wrist[0]-.004,wrist[1]+.057,wrist[2]-.004],[wrist[0]+.059,wrist[1]+.057,wrist[2]-.004],
      [wrist[0]+.059,wrist[1]+.057,wrist[2]+.056],[wrist[0]-.004,wrist[1]+.057,wrist[2]+.056],[.54,.75,.66]);
    const otherElbow=[x-.22,1.80,z-.045],otherHand=[x-.075,watchHeight-.07,z-.28];
    bar([x-.145,2.00,z+.024],otherElbow,.065,shirt);
    bar(otherElbow,otherHand,.039,skin);
    oval(otherHand,[.042,.038,.049],skin);
    const mastX=-1.24;
    bar([mastX,.85,0],[mastX,6.6,0],.055,ivory);
    bar([mastX-.48,5.1,0],[mastX+.48,5.1,0],.036,ivory);
    const angle=state.conditions.dir*Math.PI/180;
    const down=[-Math.sin(angle),Math.cos(angle)],across=[-down[1],down[0]];
    const blue=[.08,.25,.62],red=[.86,.12,.12];
    function flag(code,top,width,height){
      const root=point(mastX,top,0);
      function cloth(u,v){
        const flutter=u*.13*Math.sin(t*3.2-u*5+top);
        return [root[0]+width*u*down[0]+flutter*across[0],root[1]-v*height-u*.13,root[2]+width*u*down[1]+flutter*across[1]];
      }
      const rows=7,cols=11;
      const letters=["00000000000","01110011100","01000010010","01000011100","01000010100","01110010010","00000000000"];
      const reverse=(camera.eye[0]-root[0])*across[0]+(camera.eye[2]-root[2])*across[1]<0;
      for(let j=0;j<cols;j++)for(let i=0;i<rows;i++){
        const u=(j+.5)/cols,v=(i+.5)/rows;
        let color=ivory;
        if(code==="CR")color=letters[i][reverse?cols-1-j:j]==="1"?navy:ivory;
        else if(code==="n3")color=u<.5?red:ivory;
        else if(code==="star"){
          const x=(u-.5)*1.42,y=.5-v,r=Math.hypot(x,y),angle=Math.atan2(x,y);
          color=r<.13+.19*(.5+.5*Math.cos(5*angle))**2?red:ivory;
        }
        else if(code==="P")color=u>.25&&u<.75&&v>.22&&v<.78?ivory:blue;
        else if(code==="X")color=Math.abs(u-.5)<.096||Math.abs(v-.5)<.11?blue:ivory;
        else{
          const circle=((u-.35)*1.6)**2+(v-.5)**2<.053;
          color=code==="n1"?(circle?red:ivory):(circle?ivory:blue);
        }
        const pennant=code==="n1"||code==="n2"||code==="n3";
        const at=(u,v)=>cloth(u,pennant?.5+(v-.5)*(1-.58*u):v);
        quad(at(j/cols,i/rows),at((j+1)/cols,i/rows),at((j+1)/cols,(i+1)/rows),at(j/cols,(i+1)/rows),color,false);
      }
    }
    flag("CR",6.55,2.15,1.16);
    if(isStart)state.signals.forEach(([code],i)=>flag(code,5.05-i*1.18,1.55,.92));
  }
  function gateFloat(point,isStart,clock){
    const color=isStart?[.95,.68,.14]:[.59,.84,.35];
    buoy(point.x,point.y,0,.42,color,clock);
    rod([point.x,0,point.y],[point.x,2.7,point.y],.035,graphite);
    quad([point.x,2.65,point.y],[point.x+.86,2.54,point.y+.20],
      [point.x+.86,2.07,point.y+.18],[point.x,2.13,point.y],color);
  }
  const foam=[.84,.96,.94], wakeGreen=[.37,.69,.69], bubble=[.96,.99,.96];
  const cap=(value)=>Math.max(0,Math.min(1,value));
  const wakeHash=(x,z)=>{const n=Math.sin(x*127.1+z*311.7)*43758.5453;return n-Math.floor(n);};
  function contactShadow(boat,state){
    const {course:{water},oceanTime,boatClass}=state;
    const length=dinghies[boatClass].length*.465;
    const dx=Math.sin(boat.h),dz=-Math.cos(boat.h);
    function onSurface(x,z){
      const wx=boat.x+x*-dz+z*dx+.12, wz=boat.y+x*dx+z*dz+.11;
      return [wx,waterSample(water,wx,wz,oceanTime).height+.012,wz];
    }

    for(const [width,reach,strength] of [[.49,.87,.17],[.72,1.04,.16],[.94,1.16,.08]]){
      for(let i=0;i<14;i++){
        const a=i/14*Math.PI*2,b=(i+1)/14*Math.PI*2;
        const edge=t=>onSurface(Math.sin(t)*width,Math.cos(t)*length*reach);
        const outer=t=>onSurface(Math.sin(t)*(width+.15),Math.cos(t)*(length*reach+.12));
        if(width>.70)quad(edge(a),outer(a),outer(b),edge(b),[.02,.10,.12],false,strength);
      }
    }
  }
  function wake(boat,state){
    const {course:{water},oceanTime:t,conditions,boatClass}=state;
    const stern=dinghies[boatClass].length*.509;
    const currentAngle=conditions.currentDir*Math.PI/180;
    const driftX=Math.sin(currentAngle)*conditions.current,driftZ=-Math.cos(currentAngle)*conditions.current;
    function sample(w){
      const age=Math.max(0,t-w.stamp);
      const sin=Math.sin(w.h),cos=Math.cos(w.h);
      const speed=cap((w.speed-.15)/6)**.65;
      return {x:w.x-sin*stern+driftX*age,z:w.y+cos*stern+driftZ*age,
        age,speed,throughWater:w.speed,sin,cos,opacity:speed*(1-cap(age/12))**1.8};
    }
    const newest={...boat,stamp:t,speed:boat.waterSpeed};
    const trail=boat.wake.slice(boat.i?-38:-62).map(sample);
    trail.push(sample(newest));
    const surface=(x,z)=>[x,waterSample(water,x,z,t).height+.055,z];
    const vertex=(w,lateral,along=0)=>surface(w.x+w.cos*lateral+w.sin*along,w.z+w.sin*lateral-w.cos*along);
    for(let i=1;i<trail.length;i++){
      const a=trail[i-1],b=trail[i];
      const length=Math.hypot(a.x-b.x,a.z-b.z);
      const strength=(a.opacity+b.opacity)*.5;
      if(length<.05||strength<.015)continue;
      const spread=w=>.38+w.age*(.12+Math.min(.55,.28*w.throughWater));
      const ageFalloff=1-cap(b.age/8);
      const churn=w=>(.20+.32*w.speed)*(1+Math.sqrt(w.age)*.34);
      const center=[vertex(a,-churn(a)),vertex(a,churn(a)),vertex(b,churn(b)),vertex(b,-churn(b))];
      if(gl){
        const uva=(t-a.age)*2.4,uvb=(t-b.age)*2.4;
        materialQuad(...center,bubble,strength*.91,12,[[0,uva],[1,uva],[1,uvb],[0,uvb]]);
      }else{
        quad(...center,wakeGreen,false,strength*.26);
        const seed=Math.floor((t-b.age)*6.25+.5);
        for(let k=0;k<(boat.i?1:3);k++){
          const side=wakeHash(seed,k+51)*1.7-.85;
          const span=.035+.10*wakeHash(seed,k+64);
          quad(vertex(a,(side-span)*churn(a)),vertex(a,(side+span)*churn(a)),
            vertex(b,(side+span*.6)*churn(b)),vertex(b,(side-span*.4)*churn(b)),bubble,false,strength*.41);
        }
      }
      const noise=wakeHash(Math.floor((t-a.age)*6.25+.5),4);
      for(const flank of [-1,1]){
        if(!boat.i && b.age<5 && noise>.22){
          const swirl=.5+.29*Math.sin((t-b.age)*2.8+flank+b.age*.7);
          const edge=flank*churn(b)*swirl;
          const start=flank*churn(a)*(swirl+.12);
          const mid=vertex(b,edge+.065*flank,.10);
          triangle(vertex(a,start),mid,vertex(b,edge-.033*flank,.05),bubble,false,strength*(.18+.42*noise));
        }
        const ribbon=w=>flank*(churn(w)*.50+.055*Math.sin(w.age*4+flank));
        const width=.025+.09*b.speed;
        const ribbonCorners=[vertex(a,ribbon(a)-width),vertex(a,ribbon(a)+width),
          vertex(b,ribbon(b)+width),vertex(b,ribbon(b)-width)];
        const opacity=strength*(.16+.49*noise)*(.52+.48*ageFalloff);
        if(boat.i)quad(...ribbonCorners,bubble,false,opacity);
        else materialQuad(...ribbonCorners,bubble,opacity,4,[[0,a.age],[1,a.age],[1,b.age],[0,b.age]]);
      }
      for(const side of [-1,1]){
        const taper=.045+noise*.09+b.speed*.07;
        const aa=side*spread(a),bb=side*spread(b);
        quad(vertex(a,aa),vertex(b,bb),vertex(b,bb+side*taper),vertex(a,aa+side*taper),
          foam,false,strength*(.48+.49*noise));
      }
      // Short transverse crests and broken foam following each emitted stern section.
      const crestPhase=(t-a.age)*2.4;
      for(const side of [-1,1]){
        const outer=side*spread(b),inner=outer*.48;
        const az=Math.sin(crestPhase)*.19-.28;
        if(noise>.46){
          quad(vertex(b,inner,az),vertex(b,outer,az+.34),
            vertex(b,outer,az+.40),vertex(b,inner,az+.065),[.63,.82,.82],false,strength*.54);
        }
        const rib=side*churn(b)*(.15+noise*.64);
        quad(vertex(a,rib-.035),vertex(a,rib+.025),vertex(b,rib+.09,.05),vertex(b,rib+.02,.05),
          [ .77,.89,.86 ],false,strength*(.18+noise*.47));
      }
      if(noise>.29&&b.age<8){
        const x=(noise-.64)*churn(b)*2.3, size=.06+noise*.12+b.speed*.08;
        triangle(vertex(b,x-size,-size),vertex(b,x+size,-size*.7),vertex(b,x+size*.4,size),
          bubble,false,strength*.84);
      }
    }
    const speed=cap((boat.waterSpeed-.22)/2.9)**.72;
    if(speed<=0)return;
    const bow=dinghies[boatClass].length*.478;
    const mark={x:boat.x,z:boat.y,sin:Math.sin(boat.h),cos:Math.cos(boat.h)};
    for(const side of [-1,1]){
      for(let i=0;i<9;i++){
        const u=i/9, v=(i+1)/9;
        const width=fraction=>side*(.09+fraction*(.69+speed*.83)+.05*Math.sin(10*fraction-t*4));
        const along=t=>bow-t*(1.1+speed*1.5);
        const edge=t=>vertex(mark,width(t),along(t));
        const rim=t=>vertex(mark,width(t)+side*(.04+speed*.12),along(t));
        const opacity=speed*(1-u)**.58*(.56+.17*Math.sin(t*4.7+i*.96));
        quad(edge(u),edge(v),rim(v),rim(u),foam,false,opacity);
      }
      const airborne=(x,z,lift)=>{const point=vertex(mark,x,z);point[1]+=lift;return point;};
      for(let i=0;i<6;i++){
        const phase=(t*(1.8+speed)+i*.17)%1;
        const width=(.22+phase*.98)*side;
        const length=bow-phase*(1.6+speed*.75);
        const size=.04+.12*phase*speed;
        const gustSpray=cap((conditions.wind-11)/12)*cap(Math.abs(boat.heel)/.42);
        const lift=Math.sin(Math.PI*phase)*speed*(.29+.79*gustSpray);
        const pos=airborne(width,length,lift);
        if(drawSpray){drops.push(...pos,size,speed*(1-phase)*.88);}
        else if(gl){
          const sideVec=[mark.cos*size*.42,0,mark.sin*size*.42];
          const down=[sideVec[0]*.45,-size,sideVec[2]*.45];
          const left=sub(pos,sideVec),right=add(pos,sideVec);
          materialQuad(left,right,add(right,down),add(left,down),bubble,speed*(1-phase)*.88,13,
            [[0,0],[1,0],[1,1],[0,1]]);
        }else triangle(pos,airborne(width+side*size*.48,length-size*.4,lift+size*.38),
          airborne(width+side*size*.3,length-size,lift),bubble,false,speed*(1-phase)*.70);
      }
    }
  }

  // Canvas fallback renders the same world-space waves at a smaller resolution.
  const atmosphereCanvas=software?document.createElement("canvas"):null;
  const atmosphereContext=atmosphereCanvas?.getContext("2d");
  let atmosphereImage, lastAtmosphere=-Infinity;
  function valueNoise(x,z){
    const i=Math.floor(x),j=Math.floor(z);
    let u=x-i,v=z-j;u=u*u*(3-2*u);v=v*v*(3-2*v);
    const a=wakeHash(i,j),b=wakeHash(i+1,j),c=wakeHash(i,j+1),d=wakeHash(i+1,j+1);
    return (a+(b-a)*u)*(1-v)+(c+(d-c)*u)*v;
  }
  const colorMix=(a,b,x)=>a+(b-a)*x;
  function drawAtmosphere(ctx,state,width,height,f,r,u,lens){
    const clock=state.oceanTime, eye=camera.eye;
    const rasterWidth=Math.min(252,Math.max(132,Math.round(184*width/height)));
    const rasterHeight=Math.max(72,Math.round(rasterWidth*height/width));
    const resized=atmosphereCanvas.width!==rasterWidth||atmosphereCanvas.height!==rasterHeight;
    if(resized||!atmosphereImage){
      atmosphereCanvas.width=rasterWidth;atmosphereCanvas.height=rasterHeight;
      atmosphereImage=atmosphereContext.createImageData(rasterWidth,rasterHeight);
    }
    if(resized||clock<lastAtmosphere||clock-lastAtmosphere>.060){
      const weatherSky=document.body.dataset.sky;
      const data=atmosphereImage.data, waves=state.course.water;
      const wind=waves[2], wx=wind.x,wz=wind.z;
      const bearing=state.conditions.dir*Math.PI/180;
      const gxWind=Math.sin(bearing),gzWind=-Math.cos(bearing);
      const rippleClock=clock*(.26+.062*Math.min(55,Math.max(0,state.conditions.wind)));
      const gustRange=Math.max(0,state.conditions.gust-state.conditions.wind);
      let cursor=0;
      for(let row=0;row<rasterHeight;row++){
        const sy=(1-(row+.5)*2/rasterHeight)*lens[1];
        for(let col=0;col<rasterWidth;col++){
          const sx=((col+.5)*2/rasterWidth-1)*lens[0];
          let x=f[0]+r[0]*sx+u[0]*sy,y=f[1]+r[1]*sx+u[1]*sy,z=f[2]+r[2]*sx+u[2]*sy;
          const rayLength=1/Math.hypot(x,y,z);x*=rayLength;y*=rayLength;z*=rayLength;
          let red,green,blue;
          if(y>=0){
            const haze=Math.sqrt(cap(y*1.5));
            const px=x/(.23+y)*3.6+clock*.003,pz=z/(.23+y)*3.6+1.7;
            const density=.63*valueNoise(px,pz)+.26*valueNoise(px*2.1+7.8,pz*2.1)+.11*valueNoise(px*4.23,pz*4.23+3.7);
            const veil=weatherSky==="clear"?0:weatherSky==="rain"||weatherSky==="cloudy"?.92:cap((density-.535)*6.8)*cap((y-.015)*6.8)*.89;
            const sunDot=Math.max(0,x*daylight[0]+y*daylight[1]+z*daylight[2]);
            const overcast=weatherSky==="rain"||weatherSky==="cloudy";
            const sunGlow=(sunDot**7*50+cap((sunDot-.9989)*1100)*150)*(overcast?.08:1);
            const bank=valueNoise(px-.24,pz-.28);
            const shade=cap(.50+(density-bank)*2.8);
            const cloudTone=overcast?(weatherSky==="rain"?113:148)+42*shade:167+83*shade;
            red=colorMix(194-126*haze,cloudTone+8*density,veil)+sunGlow;
            green=colorMix(214-77*haze,cloudTone+7+6*density,veil)+sunGlow*.79;
            blue=colorMix(222-40*haze,cloudTone+14+4*density,veil)+sunGlow*.50;
          }else{
            let depth=-eye[1]/y;
            if(depth<86){
              const approach=waterSample(waves,eye[0]+depth*x,eye[2]+depth*z,clock);
              depth=Math.max(.6,depth+approach.height/y*.72);
            }
            const px=eye[0]+depth*x,pz=eye[2]+depth*z;
            const sample=waterSample(waves,px,pz,clock);
            const detail=Math.exp(-depth*.034);
            const a=px*wx+pz*wz,b=-px*wz+pz*wx;
            const warp=detail>.05?3*valueNoise(a*.37+clock*.18,b*.62):0;
            const pulse=depth<380?gustPulse(px*gxWind+pz*gzWind,-px*gzWind+pz*gxWind,clock,state.conditions.wind):0;
            const localWind=state.conditions.wind+gustRange*pulse;
            const textureGain=Math.min(1.9,localWind*.086);
            const breakers=breakerStrength(localWind);
            const gustTexture=pulse*Math.min(1,gustRange*.31)*(1-cap((depth-110)/270));
            const fine=textureGain*(.041+.035*gustTexture)*Math.sin(a*3.63+b*1.43+rippleClock*4.8+warp)*detail;
            const texel=(((Math.floor((b*.23+warp*.04)*256)&255)*256)+(Math.floor((a*.20+rippleClock*.17+warp*.04)*256)&255))*4;
            const ripple=detailPixels?detailPixels[texel+2]/255-.5:0;
            const micro=textureGain*(.053*ripple+.027*Math.sin(a*6.22-b*2.35+rippleClock*6.6))*detail;
            const distant=cap((depth-19)/126);
            const slopeDetail=1-.83*distant*distant*(3-2*distant);
            let nx=-sample.slopeX*slopeDetail+wx*fine-wz*micro;
            let nz=-sample.slopeZ*slopeDetail+wz*fine+wx*micro;
            const ny=1/Math.hypot(nx,1,nz);
            nx*=ny;nz*=ny;
            const incidence=cap(-(x*nx+y*ny+z*nz));
            const fresnel=.05+.95*(1-incidence)**4;
            const reflection=Math.max(0,y+2*incidence*ny);
            const reflectedSun=Math.max(0,(x+2*incidence*nx)*daylight[0]+reflection*daylight[1]+(z+2*incidence*nz)*daylight[2]);
            const glint=(reflectedSun**27*95+reflectedSun**110*119)*(weatherSky==="rain"?.12:weatherSky==="cloudy"?.32:1);
            const fog=cap((depth-135)/1500);
            const tone=sample.height*11+fine*40-gustTexture*17;
            red=colorMix(colorMix(13+tone,170-reflection*90,fresnel)+glint,172,fog);
            green=colorMix(colorMix(66+tone,194-reflection*58,fresnel)+glint*.87,193,fog);
            blue=colorMix(colorMix(78+tone,205-reflection*35,fresnel)+glint*.63,202,fog);
            if(breakers && depth<530){
              const phase=a*wind.k+wind.omega*clock+wind.offset;
              const gx=a*.047+rippleClock*.073,gy=b*.083;
              const gust=valueNoise(gx,gy),bend=valueNoise(gx*2.7+9.4,gy*2.7-2.1);
              const u=a*.51+rippleClock*.32+bend*2.7,v=b*.29+gust*2.2;
              const detailPatch=valueNoise(u,v)+.19*valueNoise(u*3.6,v*3.6);
              const localPhase=phase+(bend-.5)*2.1+(detailPatch-.5)*1.5,ridge=Math.cos(localPhase);
              const grain=depth<85?valueNoise(u*5+detailPatch*3,v*8+bend*2):.56;
              const crest=Math.max(cap((ridge-.84+.32*gust)/(.15+.32*gust)),(.16+.44*bend)*cap((ridge-.32)/.54)*cap((Math.sin(localPhase)-.55)/.39));
              const wash=cap((Math.cos(localPhase+.82)+.15)/.85)*cap((-Math.sin(localPhase)-.10)/.80);
              const foam=cap((gust+.13*(bend-.5)-.32)/.37)*(.28+.72*cap((grain-.25)/.39))*Math.max(crest,.43*breakers*wash)*cap((detailPatch-.70+.24*breakers)/.13)*breakers*(1-cap((depth-100)/430));
              red=colorMix(red,224,foam);green=colorMix(green,240,foam);blue=colorMix(blue,232,foam);
            }
          }
          data[cursor++]=red;data[cursor++]=green;data[cursor++]=blue;data[cursor++]=255;
        }
      }
      atmosphereContext.putImageData(atmosphereImage,0,0);
      lastAtmosphere=clock;
    }
    ctx.imageSmoothingEnabled=true;
    ctx.drawImage(atmosphereCanvas,0,0,width,height);
  }

  function drawSoftware(state,width,height,f,r,u,lens,fleetStart,fleetEnd){
    const ctx=software, eye=camera.eye;
    function project(x,y,z){
      const dx=x-eye[0],dy=y-eye[1],dz=z-eye[2];
      const depth=dx*f[0]+dy*f[1]+dz*f[2];
      if(depth<.16)return null;
      return [
        width*(.5+(dx*r[0]+dy*r[1]+dz*r[2])/(2*lens[0]*depth)),
        height*(.5-(dx*u[0]+dy*u[1]+dz*u[2])/(2*lens[1]*depth)),
        depth
      ];
    }
    const horizon=height*(.5+f[1]/(Math.max(.001,u[1])*2*lens[1]));
    const waterline=Math.max(0,Math.min(height,horizon));
    drawAtmosphere(ctx,state,width,height,f,r,u,lens);
    const {water}=state.course;
    const clock=state.oceanTime;
    const swell=water[0], sx=-swell.z,sz=swell.x;
    // Sample a fixed world grid, so nearby ripples pass the moving camera.
    const drawRipples=(cell,cells,near)=>{
      const baseX=Math.floor(eye[0]/cell),baseZ=Math.floor(eye[2]/cell);
      for(let i=-cells;i<=cells;i++)for(let j=-cells;j<=cells;j++){
        const tileX=baseX+i,tileZ=baseZ+j;
        const seed=wakeHash(tileX,tileZ);
        const x=(tileX+seed)*cell,z=(tileZ+wakeHash(tileZ,tileX+2.3))*cell;
        const dx=x-eye[0],dz=z-eye[2],radius=Math.hypot(dx,dz);
        const fade=near?(1-cap((radius-12)/9))*.78:cap((radius-13)/9)*(1-cap((radius-47)/15))*.54;
        if(fade<.02||dx*f[0]+dz*f[2]<1)continue;
        const duration=clock*(.26+.062*Math.min(55,state.conditions.wind))*(1.2+seed*.9)+seed*8.1;
        const span=(near?.19:.59)+seed*(near?.86:2.28);
        const sample=waterSample(water,x,z,clock);
        const y=sample.height+.035*Math.sin(duration);
        const p=project(x,y,z),q=project(x+sx*span,y,z+sz*span);
        if(!p||!q||p[1]<waterline||p[1]>height+40||p[0]<-40||p[0]>width+40)continue;
        const opacity=Math.min(1.5,state.conditions.wind*.086)*fade*(.06+.21*seed)*(.32+.68*(.5+.5*Math.sin(duration)));
        ctx.strokeStyle=seed>.28?"rgba(190,230,223,"+opacity+")":"rgba(10,50,62,"+opacity+")";
        ctx.lineWidth=Math.max(.62,3/Math.max(2,p[2])**.40);ctx.beginPath();
        ctx.moveTo(p[0],p[1]);ctx.quadraticCurveTo((p[0]+q[0])*.5,(p[1]+q[1])*.5-.6,q[0],q[1]);ctx.stroke();
      }
    };
    drawRipples(1.55,15,true);
    drawRipples(4.5,15,false);
    const faces=[];
    for(const vertices of [landscapeMesh,mesh]){
      for(let i=0;i<vertices.length;i+=30){
        const a=project(vertices[i],vertices[i+1],vertices[i+2]);
        const b=project(vertices[i+10],vertices[i+11],vertices[i+12]);
        const c=project(vertices[i+20],vertices[i+21],vertices[i+22]);
        if(!a||!b||!c)continue;
        if(Math.max(a[0],b[0],c[0])<0||Math.min(a[0],b[0],c[0])>width||
           Math.max(a[1],b[1],c[1])<0||Math.min(a[1],b[1],c[1])>height)continue;
        const d=(a[2]+b[2]+c[2])/3;
        const haze=cap((d-240)/4660);
        const fog=haze*haze*(3-2*haze);
        const kind=vertices[i+9];
        let gain=1;
        if(detailPixels&&(kind===6||kind===2)){
          const freq=kind===6?.43:.83;
          const tx=Math.floor((vertices[i+7]+vertices[i+17]+vertices[i+27])*freq*256/3)&255;
          const ty=Math.floor((vertices[i+8]+vertices[i+18]+vertices[i+28])*freq*256/3)&255;
          const value=detailPixels[(ty*256+tx)*4+(kind===2?1:0)]/255;
          gain=kind===6?.83+value*.35:.94+.12*value;
        }
        const color=[.66,.75,.78].map((v,k)=>{
          const avg=(vertices[i+3+k]+vertices[i+13+k]+vertices[i+23+k])/3;
          return Math.round(255*(avg*gain*(1-fog)+v*fog));
        });
        let opacity=vertices[i+6];
        if(vertices===mesh && i>=fleetStart*10 && i<fleetEnd*10){
          const y=(vertices[i+1]+vertices[i+11]+vertices[i+21])/3;
          if(y<3){
            const x=(vertices[i]+vertices[i+10]+vertices[i+20])/3,z=(vertices[i+2]+vertices[i+12]+vertices[i+22])/3;
            const depth=waterSample(water,x,z,clock).height-y;
            if(depth>0){
              const wet=cap(depth/.075),path=depth/Math.max(.35,Math.abs(eye[1]-y)/Math.max(.1,d));
              opacity+=(.035+.18*Math.exp(-1.35*path)-opacity)*wet;
              for(let k=0;k<3;k++)color[k]=Math.round(color[k]+([14,36,38][k]-color[k])*wet);
            }
          }
        }
        const swanMark=kind===19 && vertices[i+8]<.85 && vertices[i+8]>.62;
        const uv=kind===3||swanMark?[i,i+10,i+20].map(at=>[vertices[at+7],vertices[at+8]]):null;
        faces.push({a,b,c,d,opacity,uv,swanMark,color:"rgba("+color.join(",")+","+opacity+")"});
      }
    }
    faces.sort((a,b)=>b.d-a.d);
    for(const {a,b,c,color,opacity,uv,swanMark} of faces){
      ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.lineTo(c[0],c[1]);ctx.closePath();
      if(swanMark){ctx.fillStyle=color;ctx.fill();ctx.strokeStyle=color;ctx.lineWidth=.56;ctx.stroke();}
      if(uv && (swanMark || (emblem.complete && emblem.naturalWidth))){
        const [start,end,corner]=uv;
        const ab=sub(b,a),ac=sub(c,a);
        const du=end[0]-start[0],dv=end[1]-start[1];
        const cu=corner[0]-start[0],cv=corner[1]-start[1];
        const det=du*cv-dv*cu;
        const u=scale(sub(scale(ab,cv),scale(ac,dv)),1/det);
        const v=scale(sub(scale(ac,du),scale(ab,cu)),1/det);
        const origin=sub(sub(a,scale(u,start[0])),scale(v,start[1]));
        ctx.save();ctx.clip();
        ctx.transform(u[0],u[1],v[0],v[1],origin[0],origin[1]);
        if(swanMark){
          ctx.translate(.50,.77);
          ctx.scale(u[0]<0?-.21:.21,-.054);
          ctx.fillStyle="#d5dbd3";ctx.font="bold 1px sans-serif";
          ctx.textAlign="center";ctx.textBaseline="middle";ctx.fillText("36",0,0);
        }else ctx.drawImage(emblem,0,0,1,1);
        ctx.restore();
        continue;
      }
      if(opacity===1){ctx.strokeStyle=color;ctx.lineWidth=.56;ctx.stroke();}
      ctx.fillStyle=color;ctx.fill();
    }
  }

  // Cache the coast from the racing area, independent of the chase camera.
  // Only four small horizon faces contain scenery. The polar faces represent sky.
  const shoreProbe=gl?.createTexture();
  let probeVenue=null;
  function bakeShore(venue){
    const size=128,target=gl.TEXTURE_CUBE_MAP;
    const fb=gl.createFramebuffer(),depth=gl.createRenderbuffer();
    gl.bindTexture(target,shoreProbe);
    gl.texParameteri(target,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(target,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(target,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(target,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.bindRenderbuffer(gl.RENDERBUFFER,depth);
    gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,size,size);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depth);
    gl.viewport(0,0,size,size);
    gl.clearColor(0,0,0,0);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(objects);
    gl.uniform1f(lookup(objects,"linearTarget"),0);
    gl.uniform3fv(lookup(objects,"distanceHaze"),[.64,.73,.77]);
    gl.bindBuffer(gl.ARRAY_BUFFER,landscape);
    const attrs=[["point",3,0],["shade",4,12],["finish",3,28]].map(([name,count,offset])=>{
      const loc=lookup(objects,name,true);
      gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,count,gl.FLOAT,false,40,offset);
      return loc;
    });
    const faces=[[[1,0,0],[0,0,-1]],[[-1,0,0],[0,0,1]],null,null,[[0,0,1],[1,0,0]],[[0,0,-1],[-1,0,0]]];
    faces.forEach((axes,i)=>{
      const face=gl.TEXTURE_CUBE_MAP_POSITIVE_X+i;
      gl.texImage2D(face,0,gl.RGBA,size,size,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,face,shoreProbe,0);
      gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      if(!axes)return;
      cameraUniforms(objects,[venue.x,1.5,venue.y],axes[0],axes[1],[0,-1,0],[1,1]);
      gl.drawArrays(gl.TRIANGLES,0,landscapeCount);
    });
    attrs.forEach(loc=>gl.disableVertexAttribArray(loc));
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    gl.deleteFramebuffer(fb);gl.deleteRenderbuffer(depth);
  }

  let camera=null, seenBoat=null, renderScale=1, frameMean=1/60, scaleClock=0;
  function cameraUniforms(program,eye,forward,right,up,lens){
    for(const [key,value] of Object.entries({eye,forward,right,up}))gl.uniform3fv(lookup(program,key),value);
    gl.uniform2fv(lookup(program,"lens"),lens);
  }
  function apparentArrow(boat,state){
    const wind=state.apparentWind;
    if(boat.downSide||wind.speed<.12)return;
    const design=dinghies[state.boatClass];
    const relative=wind.from-boat.h;
    const fore=design.length*.5+.68, beam=design.beam*.5+.78;
    // Intersect the incoming bearing with an ellipse around the hull.
    const distance=1/Math.hypot(Math.cos(relative)/fore,Math.sin(relative)/beam);
    const from=[Math.sin(wind.from),0,-Math.cos(wind.from)];
    const side=[-from[2],0,from[0]];
    const tip=[boat.x+from[0]*distance,0,boat.y+from[2]*distance];
    const neck=add(tip,scale(from,.56)),tail=add(tip,scale(from,1.68));
    const height=Math.max(boat.heave+.42,...[tip,neck,tail].map(p=>
      waterSample(state.course.water,p[0],p[2],state.oceanTime).height+.28));
    tip[1]=neck[1]=tail[1]=height;
    const edge=(p,w)=>add(p,scale(side,w));
    const outline=[.025,.16,.20],paint=[.29,.90,1];
    const rim=.105, half=.066;
    quad(edge(tail,-half),edge(tail,half),edge(neck,half),edge(neck,-half),paint,false);
    for(const sign of [-1,1]){
      quad(edge(tail,sign*half),edge(tail,sign*rim),edge(neck,sign*rim),edge(neck,sign*half),outline,false);
    }
    const nose=add(tip,scale(from,.092)),left=edge(neck,-.30),right=edge(neck,.30);
    triangle(nose,left,right,paint,false);
    quad(tip,edge(neck,-.40),left,nose,outline,false);
    quad(tip,nose,right,edge(neck,.40),outline,false);
  }
  let casterStart=0;
  function renderTarget(size){
    const texture=gl.createTexture(),fb=gl.createFramebuffer(),depth=gl.createRenderbuffer();
    gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,size,size,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    for(const param of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,param,gl.LINEAR);
    for(const param of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,param,gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
    gl.bindRenderbuffer(gl.RENDERBUFFER,depth);
    gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,size,size);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    return {texture,fb,size};
  }
  const touchDisplay=window.matchMedia("(pointer: coarse)").matches;
  const reflectionTarget=gl&&renderTarget(gl2&&!touchDisplay?256:128);
  const foamTarget=gl&&renderTarget(512),stampBuffer=gl?.createBuffer();
  const stampProgram=gl&&program("varying mediump float strength; attribute vec4 stamp; void main(){gl_Position=vec4(stamp.xy,0.,1.);gl_PointSize=stamp.z; strength=stamp.w;}",
    "precision mediump float; varying mediump float strength; void main(){float r=length(gl_PointCoord-.5)*2.;gl_FragColor=vec4(strength*(1.-smoothstep(.15,1.,r)));}");
  let foamTime=-Infinity,foamX=0,foamZ=0,foamCourse;
  function drawFoam(state,player,quality){
    const elapsed=state.oceanTime-foamTime;
    if(foamCourse===state.course && elapsed>=0 && elapsed<[.10,.066,.033][quality] && Math.hypot(player.x-foamX,player.y-foamZ)<2)return;
    foamTime=state.oceanTime;foamCourse=state.course;foamX=player.x;foamZ=player.y;
    const data=[],t=state.oceanTime,design=dinghies[state.boatClass];
    const stamp=(x,z,r,power)=>data.push((x-player.x)/64,(z-player.y)/64,r*8,power);
    const dir=state.conditions.currentDir*Math.PI/180;
    for(const b of state.boats){
      if(b.offline)continue;
      for(const w of b.wake){
        const age=t-w.stamp;if(age<0||age>11||w.speed<.08)continue;
        const sin=Math.sin(w.h),cos=Math.cos(w.h),spread=design.beam*.21+age*(.22+.14*w.speed);
        const x=w.x-design.length*.48*sin+Math.sin(dir)*state.conditions.current*age;
        const z=w.y+design.length*.48*cos-Math.cos(dir)*state.conditions.current*age;
        const power=Math.min(.65,w.speed*.18)*Math.exp(-age*.32);
        for(const k of [-1,1])stamp(x+k*cos*spread,z+k*sin*spread,.22+.11*age,power);
        stamp(x,z,.24+age*.13,power*.72);
      }
      const sin=Math.sin(b.h),cos=Math.cos(b.h);
      for(const k of [-1,1])for(let j=0;j<5;j++){
        const a=design.length*(.47-.065*j),w=k*design.beam*(.05+.075*j);
        stamp(b.x+sin*a+cos*w,b.y-cos*a+sin*w,.21+.05*j,Math.min(.54,b.waterSpeed*.16));
      }
      if(b.downSide)for(let j=0;j<24;j++){
        const angle=j*Math.PI/12,phase=(t*.63)%1;
        const a=Math.cos(angle)*(design.length*.48+phase*.49),w=Math.sin(angle)*(.53+phase*.6);
        stamp(b.x+sin*a+cos*w,b.y-cos*a+sin*w,.28,.48*(1-phase));
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,foamTarget.fb);gl.viewport(0,0,512,512);
    gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.disable(gl.DEPTH_TEST);
    gl.useProgram(stampProgram);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);
    gl.bindBuffer(gl.ARRAY_BUFFER,stampBuffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STREAM_DRAW);
    const loc=lookup(stampProgram,"stamp",true);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,4,gl.FLOAT,false,0,0);
    gl.drawArrays(gl.POINTS,0,data.length/4);gl.disableVertexAttribArray(loc);gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  }
  const solarStart=new Date(),solarHour=(solarStart.getUTCHours()+21+solarStart.getUTCMinutes()/60)%24;
  const drops=[];
  const drawSpray=gl2&&createRaceSpray(gl2,program);
  const optics=gl2&&createRaceOptics(gl2,features,program,fullscreen);
  const shadowTarget=gl&&renderTarget(512);
  function drawBoatEffects(start,end,player,level,f,r,u,lens,time,wind){
    gl.useProgram(effects);
    gl.uniform1f(lookup(effects,"sceneTime"),time);
    gl.uniform1f(lookup(effects,"breeze"),wind);
    const finish=lookup(effects,"finish",true);
    gl.enableVertexAttribArray(finish);
    gl.vertexAttribPointer(finish,3,gl.FLOAT,false,40,28);
    cameraUniforms(effects,camera.eye,f,r,u,lens);
    const point=lookup(effects,"point",true),shade=lookup(effects,"shade",true);
    gl.enableVertexAttribArray(point);gl.enableVertexAttribArray(shade);
    gl.vertexAttribPointer(point,3,gl.FLOAT,false,40,0);
    gl.vertexAttribPointer(shade,4,gl.FLOAT,false,40,12);
    gl.enable(gl.DEPTH_TEST);gl.disable(gl.BLEND);gl.clearColor(0,0,0,0);
    for(const target of [reflectionTarget,shadowTarget]){
      const shadow=target===shadowTarget;
      gl.bindFramebuffer(gl.FRAMEBUFFER,target.fb);
      gl.viewport(0,0,target.size,target.size);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      gl.uniform3f(lookup(effects,"center"),player.x,shadow?player.heave:level,player.y);
      gl.uniform1f(lookup(effects,"shadowPass"),Number(shadow));
      const first=shadow?casterStart:start;
      if(end>first)gl.drawArrays(gl.TRIANGLES,first,end-first);
    }
    gl.disableVertexAttribArray(finish);gl.disableVertexAttribArray(point);gl.disableVertexAttribArray(shade);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
  }
  function draw(state){
    const {boats,course,conditions,oceanTime,dt,coast,sideView}=state;
    if(gl && dt>0 && dt<.25){
      frameMean+=(dt-frameMean)*.045;scaleClock+=dt;
      if(scaleClock>2){
        if(frameMean>.024)renderScale=Math.max(.65,renderScale-.08);
        else if(frameMean<.018)renderScale=Math.min(1,renderScale+.04);
        scaleClock=0;
      }
    }
    const quality=Number(document.getElementById("sea-quality")?.value??1);
    const ratio=[.72,.90,1][quality]*renderScale*(gl
      ?Math.min(devicePixelRatio,3.5,3072/Math.max(1,canvas.clientWidth,canvas.clientHeight))
      :Math.min(devicePixelRatio,1.55,1400/canvas.clientWidth));
    const width=Math.round(canvas.clientWidth*ratio),height=Math.round(canvas.clientHeight*ratio);
    if(!width||!height)return;
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    if(gl)gl.viewport(0,0,width,height);
    if(landscapeVenue!==course.venue.scenery){
      makeLandscape(coast,course.venue.scenery);
      landscapeVenue=course.venue.scenery;
    }
    if(gl && probeVenue!==course.venue){
      bakeShore(course.venue);probeVenue=course.venue;
      gl.viewport(0,0,width,height);
    }
    const scenery=course.venue.scenery;
    const player=boats[0], direction=[Math.sin(player.h),0,-Math.cos(player.h)];
    const subject=[player.x,0,player.y];
    const rawPace=cap(player.speed/3.8);
    const dampPace=1-Math.exp(-dt*2.6);
    const pace=seenBoat===player&&camera?camera.pace+(rawPace-camera.pace)*dampPace:rawPace;
    const compact=width/height<1.18;
    const star=state.boatClass==="star";
    const closeCockpit=state.cockpitView && (state.boatClass==="soto40"||state.boatClass==="clubswan36"||state.boatClass==="tp52"||state.boatClass==="brasil40"||classicDesigns[state.boatClass]);
    const back=closeCockpit?8.3:(compact?11.1:8.7)+pace*.70+((state.boatClass==="soto40"||state.boatClass==="clubswan36"||state.boatClass==="tp52"||state.boatClass==="brasil40"||classicDesigns[state.boatClass])?15:star?4.5:0);
    const starboard=[-direction[2],0,direction[0]];
    const presetOffset=sideView?add(scale(direction,-back*.25),scale(starboard,back*1.02)):
      add(scale(direction,-back),scale(starboard,back*(closeCockpit?.12:.32)));
    const yaw=state.orbitYaw||0, cy=Math.cos(yaw), sy=Math.sin(yaw);
    const rearQuarter=[presetOffset[0]*cy+presetOffset[2]*sy,0,presetOffset[2]*cy-presetOffset[0]*sy];
    const desiredEye=add(add(subject,rearQuarter),[0,closeCockpit?2.65+player.heave:3.15+player.heave*.36-pace*.28+((state.boatClass==="soto40"||state.boatClass==="clubswan36"||state.boatClass==="tp52"||state.boatClass==="brasil40"||classicDesigns[state.boatClass])?4:star?1.5:0),0]);
    const travel=norm([player.vx,0,player.vy]);
    const lead=norm(add(direction,scale(travel,pace*.32)));
    const desiredAim=add(add(subject,scale(lead,state.orbitActive?0:sideView?.65:3.6+pace*2.1)),[0,closeCockpit?.98:(sideView?2.74:2.28)+((state.boatClass==="soto40"||state.boatClass==="clubswan36"||state.boatClass==="tp52"||state.boatClass==="brasil40"||classicDesigns[state.boatClass])?4.8:star?1.48:0),0]);
    if(seenBoat!==player||!camera){camera={eye:desiredEye,aim:desiredAim,pace};seenBoat=player;}
    const damping=1-Math.exp(-dt*9);
    camera.eye=add(camera.eye,scale(sub(desiredEye,camera.eye),damping));
    camera.aim=add(camera.aim,scale(sub(desiredAim,camera.aim),damping));
    const f=norm(sub(camera.aim,camera.eye)), r=norm(cross(f,[0,1,0])), u=cross(r,f);
    camera.pace=pace;
    const field=.53+pace*.096;
    const lens=[field*width/height,field];
    for(const boat of boats){
      if(!boat.tag)continue;
      const design=dinghies[state.boatClass];
      const offset=sub([boat.x,boat.heave+(boat.downSide?2:design.top+.32),boat.y],camera.eye);
      const depth=dot3(offset,f);
      const x=50+50*dot3(offset,r)/(lens[0]*depth),y=50-50*dot3(offset,u)/(lens[1]*depth);
      boat.tag.hidden=boat.offline||depth<.2||x<3||x>97||y<4||y>96;
      if(!boat.tag.hidden){
        boat.tag.style.left=x+"%";
        boat.tag.style.top=y+"%";
      }
    }

    if(course.venue.scenery==="rio"){
      const a=cableway[0],b=cableway[1];
      for(const lane of [-1,1]){
        const progress=.5+.40*Math.sin(oceanTime*.075)*lane;
        const p=add(add(scale(a,1-progress),scale(b,progress)),[lane*3,-44*progress*(1-progress),-lane*3]);
        box(p[0]-6,p[1]-9,p[2]-4,12,6,8,[.83,.86,.79]);
        box(p[0]-5,p[1]-7.5,p[2]+4.1,10,3,.25,[.29,.54,.62]);
        rod(p,[p[0],p[1]-3,p[2]],.38,[.18,.22,.23]);
      }
    }
    const visibleBoats=boats.filter(boat=>{
      if(boat.offline)return false;
      if(!boat.i)return true;
      const offset=[boat.x-camera.eye[0],0,boat.y-camera.eye[2]];
      const depth=dot3(offset,f);
      return depth>-18&&Math.abs(dot3(offset,r))<Math.max(0,depth)*lens[0]+20;
    });
    for(const boat of visibleBoats){contactShadow(boat,state);wake(boat,state);}
    for(const mark of course.marks){markZone(mark,state);raceMark(mark,state);}
    for(const aid of course.channelMarks){
      const y=waterSample(course.water,aid.x,aid.y,oceanTime).height;
      const color=aid.red?[.87,.12,.08]:[.06,.55,.31];
      buoy(aid.x,aid.y,y,1,color,oceanTime);
      rod([aid.x,y+1,aid.y],[aid.x,y+3.6,aid.y],.13,color);
      rod([aid.x,y+3.5,aid.y],[aid.x,y+3.83,aid.y],.14,[.95,.95,.76]);
    }
    const start=course.startLine;
    function lineVertex(t,side){
      const x=start.a.x+(start.b.x-start.a.x)*t+start.normal.x*side;
      const z=start.a.y+(start.b.y-start.a.y)*t+start.normal.y*side;
      return [x,waterSample(course.water,x,z,oceanTime).height+.055,z];
    }
    for(let i=0;i<64;i++){
      const t=i/64,end=(i+.82)/64;
      quad(lineVertex(t,-.20),lineVertex(t,.20),lineVertex(end,.20),lineVertex(end,-.20),[.91,.95,.57],false,.86);
    }
    for(const [line,isStart] of [[course.startLine,true],[course.finishLine,false]]){
      gateFloat(line.pin,isStart,oceanTime);
      committeeLaunch(line,isStart,state);
    }
    const fleetStart=mesh.length/10;
    let playerStart=0,playerEnd=0;
    for(const boat of visibleBoats){
      if(boat===player)playerStart=mesh.length/10;
      model(boat,state);
      if(boat===player)playerEnd=mesh.length/10;
    }
    const fleetEnd=mesh.length/10;
    apparentArrow(player,state);
    if(software){
      drawSoftware(state,width,height,f,r,u,lens,fleetStart,fleetEnd);
      mesh=[];
      return;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER,geometry);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(mesh),gl.DYNAMIC_DRAW);
    gl.activeTexture(gl.TEXTURE0);
    drawBoatEffects(playerStart,playerEnd,player,waterSample(course.water,player.x,player.y,oceanTime).height,f,r,u,lens,oceanTime,conditions.wind);
    gl.viewport(0,0,width,height);
    drawFoam(state,player,quality);gl.viewport(0,0,width,height);
    const hdr=optics?.begin(width,height)||false;
    gl.disable(gl.DEPTH_TEST);gl.clearDepth(1);gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(sky);
    gl.uniform1f(lookup(sky,"linearTarget"),Number(hdr));
    cameraUniforms(sky,camera.eye,f,r,u,lens);
    gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,reflectionTarget.texture);
    gl.uniform1i(lookup(sky,"boatReflection"),3);
    gl.uniform2f(lookup(sky,"boatCenter"),player.x,player.y);
    gl.uniform1f(lookup(sky,"clock"),oceanTime);
    const tint=scenery==="canas"?[.022,.176,.181]:scenery==="rio"?[.033,.153,.166]:[.031,.142,.151];
    gl.uniform3fv(lookup(sky,"seaTint"),tint);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP,shoreProbe);
    gl.uniform1i(lookup(sky,"shoreReflection"),1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1f(lookup(sky,"skyMode"),({clear:-1,cloudy:1,rain:2})[document.body.dataset.sky]||0);
    const bearing=conditions.dir*Math.PI/180;
    gl.uniform4f(lookup(sky,"windSettings"),Math.sin(bearing),-Math.cos(bearing),conditions.wind,
      Math.max(0,conditions.gust-conditions.wind));
    gl.uniform4fv(lookup(sky,"waves[0]"),course.water.flatMap(w=>[w.x,w.z,w.k,w.amplitude]));
    gl.uniform3fv(lookup(sky,"offsets[0]"),course.water.flatMap(w=>[w.omega,w.offset,w.steepness]));
    const day=(solarHour+oceanTime/3600-6)*Math.PI/12;
    gl.uniform3fv(lookup(sky,"sun"),norm([Math.cos(day),Math.max(.025,.86*Math.sin(day)),-.42]));
    gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,foamTarget.texture);
    gl.uniform2f(lookup(sky,"foamCenter"),foamX,foamZ);
    gl.uniform1i(lookup(sky,"foamField"),4);gl.activeTexture(gl.TEXTURE0);
    gl.bindBuffer(gl.ARRAY_BUFFER,seaGrid);
    const screen=lookup(sky,"screen",true);
    gl.enableVertexAttribArray(screen);gl.vertexAttribPointer(screen,2,gl.FLOAT,false,0,0);
    gl.drawArrays(gl.TRIANGLES,...gridOffsets[quality]);gl.disableVertexAttribArray(screen);

    gl.enable(gl.DEPTH_TEST);gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);gl.useProgram(objects);
    gl.uniform1f(lookup(objects,"linearTarget"),Number(hdr));
    cameraUniforms(objects,camera.eye,f,r,u,lens);
    gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,shadowTarget.texture);
    gl.uniform1i(lookup(objects,"deckShadow"),4);
    gl.uniform3f(lookup(objects,"shadowCenter"),player.x,player.heave,player.y);
    gl.uniform1f(lookup(objects,"shadowStrength"),({cloudy:.42,rain:.20})[document.body.dataset.sky]??1);
    gl.uniform1f(lookup(objects,"sceneTime"),oceanTime);
    gl.uniform1f(lookup(objects,"breeze"),conditions.wind);
    if(gl2)gl.uniform4fv(lookup(objects,"badge"),badgeUV[state.boatClass]||badgeUV.ilca);
    if(gl2 && state.boatClass==="tp52")updateMarineLight(document.body.dataset.sky);
    const haze=scenery==="canas"?[.59,.69,.72]:[.74,.81,.86];
    gl.uniform3fv(lookup(objects,"distanceHaze"),haze);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D,crestTexture);
    gl.uniform1i(lookup(objects,"clubCrest"),0);
    const point=lookup(objects,"point",true),shade=lookup(objects,"shade",true);
    const finish=lookup(objects,"finish",true);
    gl.enableVertexAttribArray(finish);gl.enableVertexAttribArray(point);gl.enableVertexAttribArray(shade);
    function drawBuffer(buffer,count){
      gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
      gl.vertexAttribPointer(point,3,gl.FLOAT,false,40,0);
      gl.vertexAttribPointer(shade,4,gl.FLOAT,false,40,12);
      gl.vertexAttribPointer(finish,3,gl.FLOAT,false,40,28);
      gl.drawArrays(gl.TRIANGLES,0,count);
    }
    drawBuffer(landscape,landscapeCount);
    drawBuffer(geometry,fleetStart);
    gl.uniform4fv(lookup(objects,"boatWaves[0]"),course.water.flatMap(w=>[w.x,w.z,w.k,w.amplitude]));
    gl.uniform2fv(lookup(objects,"boatPhases[0]"),course.water.flatMap(w=>[w.omega*oceanTime+w.offset,w.steepness]));
    gl.uniform1f(lookup(objects,"waveLimit"),course.water.reduce((a,w)=>a+w.amplitude*(1+w.steepness),0));
    gl.uniform1f(lookup(objects,"boatWater"),1);
    gl.drawArrays(gl.TRIANGLES,fleetStart,fleetEnd-fleetStart);
    gl.uniform1f(lookup(objects,"boatWater"),0);
    gl.drawArrays(gl.TRIANGLES,fleetEnd,mesh.length/10-fleetEnd);
    mesh=[];
    gl.disable(gl.BLEND);
    gl.disableVertexAttribArray(finish);gl.disableVertexAttribArray(point);gl.disableVertexAttribArray(shade);
    if(drawSpray){gl.enable(gl.BLEND);drawSpray(drops,camera.eye,f,r,u,lens);gl.disable(gl.BLEND);}
    if(hdr)optics.finish();
  }
  return {draw};
}
