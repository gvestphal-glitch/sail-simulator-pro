"use strict";

// The scene supplies linear radiance only when a complete HDR target exists.
function createRaceOptics(gl,features,program,fullscreen){
  const vertex="attribute vec2 screen; varying vec2 uv; void main(){uv=screen*.5+.5;gl_Position=vec4(screen,0.,1.);}";
  const composite=program(vertex,`precision highp float;
    varying vec2 uv; uniform sampler2D sceneColor; uniform vec2 texel;
    vec3 bright(vec2 offset){
      vec3 c=texture2D(sceneColor,clamp(uv+offset*texel,0.,1.)).rgb;
      float l=dot(c,vec3(.2126,.7152,.0722));
      return c*max(0.,l-1.)/max(l,.001);
    }
    void main(){
      vec3 c=texture2D(sceneColor,uv).rgb;
      vec3 bloom=vec3(0.);
      for(int i=0;i<8;i++){
        float a=float(i)*.785398;
        bloom+=bright(vec2(cos(a),sin(a))*4.);
      }
      c+=.028*bloom;
      c=clamp((c*(2.51*c+.03))/(c*(2.43*c+.59)+.14),0.,1.);
      vec3 srgb=mix(12.92*c,1.055*pow(c,vec3(1./2.4))-.055,step(vec3(.0031308),c));
      gl_FragColor=vec4(srgb,1.);
    }`);
  const screen=gl.getAttribLocation(composite,"screen"),texel=gl.getUniformLocation(composite,"texel");
  let width=0,height=0,target=null;
  function release(t){
    gl.deleteFramebuffer(t.scene);gl.deleteFramebuffer(t.resolve);
    gl.deleteRenderbuffer(t.color);gl.deleteRenderbuffer(t.depth);gl.deleteTexture(t.texture);
  }
  function allocate(w,h,samples){
    const t={texture:gl.createTexture(),resolve:gl.createFramebuffer(),depth:gl.createRenderbuffer(),scene:null,color:null};
    function complete(){return gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE;}
    gl.bindTexture(gl.TEXTURE_2D,t.texture);
    gl.texStorage2D(gl.TEXTURE_2D,1,gl.RGBA16F,w,h);
    for(const param of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,param,gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER,t.resolve);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t.texture,0);
    let valid=complete();
    if(samples){
      t.scene=gl.createFramebuffer();t.color=gl.createRenderbuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER,t.scene);gl.bindRenderbuffer(gl.RENDERBUFFER,t.color);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER,samples,gl.RGBA16F,w,h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.RENDERBUFFER,t.color);
    }
    gl.bindRenderbuffer(gl.RENDERBUFFER,t.depth);
    if(samples)gl.renderbufferStorageMultisample(gl.RENDERBUFFER,samples,gl.DEPTH_COMPONENT24,w,h);
    else gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT24,w,h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,t.depth);
    valid=valid&&complete();
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    if(!valid){release(t);return null;}
    return t;
  }
  return {
    begin(w,h){
      if(!features.hdrColorDepth)return false;
      if(w!==width||h!==height){
        if(target)release(target);
        width=w;height=h;
        // Limit transient attachment memory on high-density mobile screens.
        const samples=features.hdrMsaaSamples;
        target=samples && w*h*(12*samples+8)<64*1024*1024?allocate(w,h,samples):null;
        if(!target)target=allocate(w,h,0);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER,target?.scene||target?.resolve||null);
      return !!target;
    },
    finish(){
      if(!target)return;
      if(target.scene){
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER,target.scene);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,target.resolve);
        gl.blitFramebuffer(0,0,width,height,0,0,width,height,gl.COLOR_BUFFER_BIT,gl.NEAREST);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      gl.disable(gl.DEPTH_TEST);gl.disable(gl.BLEND);gl.useProgram(composite);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,target.texture);
      gl.uniform2f(texel,1/width,1/height);
      gl.bindBuffer(gl.ARRAY_BUFFER,fullscreen);gl.enableVertexAttribArray(screen);
      gl.vertexAttribPointer(screen,2,gl.FLOAT,false,0,0);
      gl.drawArrays(gl.TRIANGLES,0,3);gl.disableVertexAttribArray(screen);
      gl.bindTexture(gl.TEXTURE_2D,null);
    }
  };
}

// One quad per droplet. Only its centre, radius and opacity vary by instance.
function createRaceSpray(gl,program){
  const shader=program(`attribute vec2 corner; attribute vec4 drop; attribute float opacity;
    uniform vec3 eye,forward,right,up;uniform vec2 lens;
    varying vec2 p;varying float alpha;
    void main(){vec3 d=drop.xyz-eye;float z=dot(d,forward);p=corner;alpha=opacity;
      gl_Position=vec4((vec2(dot(d,right),dot(d,up))+corner*drop.w*vec2(.46,.78))/lens,1.000036*z-.36,z);}`,
    `precision mediump float;varying vec2 p;varying float alpha;void main(){
      gl_FragColor=vec4(.73,.86,.88,alpha*(1.-smoothstep(.08,1.,dot(p,p))));}`);
  const corners=gl.createBuffer(),instances=gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER,corners);
  gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
  const attr=k=>gl.getAttribLocation(shader,k),uniform=k=>gl.getUniformLocation(shader,k);
  const corner=attr("corner"),drop=attr("drop"),opacity=attr("opacity");
  const locations=["eye","forward","right","up","lens"].map(uniform);
  return function draw(values,eye,f,r,u,lens){
    if(!values.length)return;
    gl.useProgram(shader);
    [eye,f,r,u].forEach((v,i)=>gl.uniform3fv(locations[i],v));gl.uniform2fv(locations[4],lens);
    gl.bindBuffer(gl.ARRAY_BUFFER,corners);gl.enableVertexAttribArray(corner);gl.vertexAttribPointer(corner,2,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,instances);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(values),gl.STREAM_DRAW);
    for(const loc of [drop,opacity]){gl.enableVertexAttribArray(loc);gl.vertexAttribDivisor(loc,1);}
    gl.vertexAttribPointer(drop,4,gl.FLOAT,false,20,0);gl.vertexAttribPointer(opacity,1,gl.FLOAT,false,20,16);
    gl.depthMask(false);gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,values.length/5);gl.depthMask(true);
    for(const loc of [drop,opacity])gl.vertexAttribDivisor(loc,0);
    for(const loc of [drop,opacity,corner])gl.disableVertexAttribArray(loc);
    values.length=0;
  };
}
