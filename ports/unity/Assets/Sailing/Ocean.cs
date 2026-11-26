using System;
using UnityEngine;

namespace Sailing {
    [Serializable] public class Weather {
        public float wind=11, gust=14, dir=145, wave=.48f, waveDir=155, period=7, tide=.15f, tideRate=.11f, current=.2f, currentDir=65;
    }
    public struct Surface {
        public float height, crest;
        public Vector2 gradient, orbital;
    }
    public sealed class Ocean {
        struct Wave { public Vector2 axis; public float k, omega, amplitude, offset, sharpness, orbit; }
        readonly float wind,gustRange,direction;
        readonly Wave[] waves=new Wave[4];
        public static Vector2 Bearing(float deg) => new Vector2(Mathf.Sin(deg*Mathf.Deg2Rad),Mathf.Cos(deg*Mathf.Deg2Rad));
        public static double WaveNumber(double omega,double depth) {
            double k=omega*omega/9.81;
            for(int i=0;i<6;i++){
                double h=Math.Tanh(k*depth);
                k-=(9.81*k*h-omega*omega)/(9.81*(h+k*depth*(1-h*h)));
            }
            return k;
        }
        public Ocean(Weather w){
            wind=w.wind;gustRange=Mathf.Max(0,w.gust-wind);direction=w.dir;
            float depth=10+Mathf.Clamp(w.tide,-2,2),p=Mathf.Max(2,w.period),a=Mathf.Min(w.wave,4);
            void Set(int i,float heading,float period,float amplitude,float offset){
                float omega=2*Mathf.PI/period,k=(float)WaveNumber(omega,depth);
                waves[i]=new Wave{axis=Bearing(heading),k=k,omega=omega,amplitude=amplitude,offset=offset,
                    sharpness=Mathf.Min(.13f,k*amplitude*.45f),orbit=Mathf.Min(1.5f,1/(float)Math.Tanh(k*depth))};
            }
            Set(0,w.waveDir,p,.36f*a,0);Set(1,w.waveDir+24,p*.73f,.14f*a,1.3f);
            float knots=Mathf.Clamp(w.wind,0,55),energy=knots*knots/(knots+7);
            float periodGrowth=knots/(1+.018f*knots);
            Set(2,w.dir-13,1.25f+.063f*periodGrowth,.022f*energy,2.1f);
            Set(3,w.dir+28,.94f+.031f*periodGrowth,.007f*energy,4.7f);
        }
        public Surface At(Vector2 pos,float time){
            var s=new Surface();
            for(int i=0;i<waves.Length;i++){
                var w=waves[i];
                float phase=w.k*Vector2.Dot(pos,w.axis)+w.omega*time+w.offset;
                float c=Mathf.Cos(phase),a=w.amplitude;
                if(i==2)s.crest=c;
                s.height+=a*(c+w.sharpness*(2*c*c-1));
                s.gradient-=w.axis*(w.k*a*Mathf.Sin(phase)*(1+4*w.sharpness*c));
                s.orbital-=w.axis*(w.omega*w.orbit*a*c);
            }
            return s;
        }
        public float Foam(Vector2 pos,float time,float crest){
            float gust=Gust(pos,direction,time,wind);
            float strength=Mathf.Clamp01((wind+gustRange*gust-15)/13);
            if(strength<=0 || crest<.49f)return 0;
            float islands=Mathf.PerlinNoise(pos.x*.21f+time*.11f,pos.y*.29f);
            return strength*Mathf.SmoothStep(0,1,(crest-.49f)/.45f)*Mathf.Clamp01((islands-.46f+.12f*gust)*3.4f);
        }
        public static float Gust(Vector2 position,float direction,float time,float wind){
            time*=.22f+.062f*Mathf.Clamp(wind,0,55);
            var up=Bearing(direction);float a=Vector2.Dot(position,up),b=Vector2.Dot(position,new Vector2(up.y,-up.x));
            float ridge=Mathf.Max(0,Mathf.Cos(a*.070f+time*.45f+1.45f*Mathf.Sin(b*.089f)));
            return Mathf.Pow(ridge,4)*(.30f+.70f*(.5f+.5f*Mathf.Sin(b*.056f-a*.021f+time*.10f)));
        }
        public static Vector3 Normal(Surface s)=>new Vector3(-s.gradient.x,1,-s.gradient.y).normalized;
        public static float SprayRate(float speed,float wind)=>Mathf.Clamp01((speed-.22f)/2.9f)*(8+Mathf.Clamp(wind-15,0,25));
    }
}
