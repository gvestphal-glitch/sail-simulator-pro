Shader "Sailing/Surface" {
 Properties { _Color ("Tint",Color)=(1,1,1,1) }
 SubShader { Pass { Cull Off
 CGPROGRAM
 #pragma vertex vert
 #pragma fragment frag
 #pragma multi_compile_fog
 #include "UnityCG.cginc"
 struct Input { float4 vertex:POSITION; float4 color:COLOR; };
 struct Output { float4 pos:SV_POSITION; fixed4 color:COLOR; UNITY_FOG_COORDS(0) };
 fixed4 _Color;
 Output vert(Input i){Output o;o.pos=UnityObjectToClipPos(i.vertex);o.color=i.color*_Color;UNITY_TRANSFER_FOG(o,o.pos);return o;}
 fixed4 frag(Output i):SV_Target{fixed4 c=i.color;UNITY_APPLY_FOG(i.fogCoord,c);return c;}
 ENDCG
 } }
}
