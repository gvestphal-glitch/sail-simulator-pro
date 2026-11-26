shader_type spatial;
render_mode cull_disabled;

uniform float clock;
uniform vec4 waves[4];
uniform vec4 speeds;
uniform vec4 phases;
uniform vec4 steepness;
uniform vec3 wake_points[24];
uniform int wake_count;
varying vec2 world_xz;
varying vec3 macro_normal;

vec3 surface(vec2 p){
	vec3 field = vec3(0.0);
	for(int i=0;i<4;i++){
		vec4 w=waves[i];
		float a=dot(p,w.xy)*w.z+clock*speeds[i]+phases[i];
		float c=cos(a);
		field.x+=w.w*(c+steepness[i]*(2.0*c*c-1.0));
		field.yz-=w.xy*w.z*w.w*sin(a)*(1.0+4.0*steepness[i]*c);
	}
	return field;
}
void vertex(){
	world_xz=(MODEL_MATRIX*vec4(VERTEX,1.0)).xz;
	vec3 wave=surface(world_xz);
	VERTEX.y+=wave.x;
	macro_normal=vec3(-wave.y,1.0,-wave.z);
}
float random_value(vec2 cell){
	return fract(sin(dot(cell,vec2(127.1,311.7)))*43758.5453);
}
float noise2(vec2 p){
	vec2 i=floor(p);
	vec2 f=fract(p);
	f=f*f*(3.0-2.0*f);
	return mix(mix(random_value(i),random_value(i+vec2(1,0)),f.x),
		mix(random_value(i+vec2(0,1)),random_value(i+1.0),f.x),f.y);
}
void fragment(){
	float dist=distance(world_xz,CAMERA_POSITION_WORLD.xz);
	float closeup=1.0-smoothstep(16.0,65.0,dist);
	vec2 wind=waves[2].xy;
	vec2 across=vec2(-wind.y,wind.x);
	float fetch=dot(world_xz,wind), span=dot(world_xz,across);
	float warp=noise2(vec2(fetch*.19,span*.28)+clock*.08);
	vec2 ripples=wind*sin(fetch*7.4+span*2.8+clock*5.9+warp*2.3)*.055
		+across*sin(span*10.3-fetch*3.3+clock*7.1-warp*2.0)*.031;
	vec3 wave_normal=normalize(macro_normal+vec3(ripples.x,0.0,ripples.y)*closeup);
	NORMAL=normalize((VIEW_MATRIX*vec4(wave_normal,0)).xyz);
	float fresnel=pow(1.0-clamp(dot(NORMAL,VIEW),0.0,1.0),4.5);
	float foam=0.0;
	if(dist<46.0){
		for(int i=0;i<23;i++){
			if(i+1>=wake_count)break;
			vec3 wp=wake_points[i];
			vec2 next=wake_points[i+1].xy;
			vec2 segment=next-wp.xy;
			float u=clamp(dot(world_xz-wp.xy,segment)/max(dot(segment,segment),.001),0.0,1.0);
			float age=mix(wp.z,wake_points[i+1].z,u);
			float r=length(world_xz-wp.xy-segment*u);
			float width=.21+age*.095;
			float rim=1.0-smoothstep(.04,.13,abs(r-width));
			float turbulence=1.0-smoothstep(.05,width,r);
			foam=max(foam,max(rim*.7,turbulence*.47)*(1.0-smoothstep(.4,4.2,age)));
		}
		foam*=smoothstep(.24,.79,noise2(world_xz*7.0+clock*.29));
	}
	ALBEDO=mix(mix(vec3(.018,.125,.152),vec3(.29,.47,.56),fresnel),vec3(.78,.88,.87),foam);
	ROUGHNESS=mix(.19+warp*.11,.67,foam);
	SPECULAR=.58;
}
