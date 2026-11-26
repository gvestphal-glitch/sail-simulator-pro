using System;
using UnityEngine;

namespace Sailing {
    public sealed class Helm {
        public readonly string id;
        public readonly float length,turnGain,inertia,drag,mast,jibShare;
        readonly float[] polar=new float[121*181];
        public Helm(string id){
            this.id=id;
            switch(id){
                case "star":length=6.922f;turnGain=.73f;inertia=2.65f;drag=.020f;mast=1.02f;jibShare=.23f;break;
                case "snipe":length=4.724f;turnGain=.86f;inertia=1.22f;drag=.019f;mast=.45f;jibShare=.29f;break;
                case "optimist":length=2.30f;turnGain=1.12f;inertia=.83f;drag=.025f;mast=.67f;break;
                default:length=4.23f;turnGain=1;inertia=1;drag=.017f;mast=.81f;break;
            }
            var bytes=Resources.Load<TextAsset>(id+"-polar").bytes;
            if(bytes.Length!=polar.Length*4)throw new InvalidOperationException("Invalid polar: "+id);
            Buffer.BlockCopy(bytes,0,polar,0,bytes.Length);
        }
        public static float Steering(float axis){
            float travel=Mathf.Clamp01((Mathf.Abs(axis)-.055f)/.945f);
            return Mathf.Sign(axis)*(.24f*travel+.76f*Mathf.Pow(travel,1.8f));
        }
        public float Knots(float wind,float angle){
            float w=Mathf.Clamp(wind*2,0,120),a=Mathf.Clamp(Mathf.Abs(angle),0,180);
            int i=Mathf.Min(119,(int)w),j=Mathf.Min(179,(int)a);
            float Row(int row)=>Mathf.Lerp(polar[row*181+j],polar[row*181+j+1],a-j);
            return Mathf.Lerp(Row(i),Row(i+1),w-i);
        }
        public float Acceleration(float target,float surge,float rudder){
            float Resistance(float v)=>drag*v*Mathf.Abs(v)+.034f*v;
            float surplus=Resistance(target)-Resistance(surge);
            return (surplus*(surplus>0?2.15f:1)-.047f*Mathf.Abs(rudder)*surge)/inertia;
        }
    }
}
