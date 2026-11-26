using System.Collections.Generic;
using UnityEngine;
namespace Sailing {
    // Ownership is recorded on first zone entry while the pair approaches the same mark.
    public sealed class MarkRoom {
        readonly Dictionary<int,int> owners=new Dictionary<int,int>();
        public static bool Inside(Vector2 center,Vector2 mark,float length,float heading,float beam){
            var f=Ocean.Bearing(heading);var d=mark-center;float along=Mathf.Clamp(Vector2.Dot(d,f),-length*.5f,length*.5f);
            float ratio=2*along/length;float halfWidth=beam*.5f*(1-.65f*ratio*ratio);
            return (d-along*f).magnitude<=3*length+halfWidth;
        }
        public int Update(int pair,int id,Vector2 mark,Encounter a,Encounter b,float wind,float beam){
            int key=pair*8+id;
            bool first=Inside(a.position,mark,a.length,a.heading,beam),second=Inside(b.position,mark,b.length,b.heading,beam);
            float ta=Mathf.DeltaAngle(wind,a.heading),tb=Mathf.DeltaAngle(wind,b.heading);
            if((!first&&!second)||a.returning||b.returning||a.turning||b.turning||a.tacking||b.tacking||
              ((ta>0)!=(tb>0)&&(Mathf.Abs(ta)<90||Mathf.Abs(tb)<90))){owners.Remove(key);return -1;}
            if(owners.TryGetValue(key,out int owner))return owner;
            var d=a.position-b.position;
            bool aAstern=Vector2.Dot(d,Ocean.Bearing(b.heading))<-.5f*(a.length+b.length);
            bool bAstern=Vector2.Dot(-d,Ocean.Bearing(a.heading))<-.5f*(a.length+b.length);
            owner=aAstern?1:bAstern?0:(a.position-mark).sqrMagnitude<=(b.position-mark).sqrMagnitude?0:1;
            owners[key]=owner;return owner;
        }
        public void Forget(int pair){for(int i=0;i<4;i++)owners.Remove(pair*8+i);}
    }
}
