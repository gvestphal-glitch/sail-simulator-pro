using UnityEngine;

namespace Sailing {
    public struct Encounter {
        public Vector2 position;public float heading,length;
        public bool returning,turning,tacking,capsized;
        public Encounter(Vector2 p,float h,float l){position=p;heading=h;length=l;returning=turning=tacking=capsized=false;}
    }
    public struct Duty {
        public int boat,rule;
        public Duty(int boat,int rule){this.boat=boat;this.rule=rule;}
    }
    public static class Passage {
        // Index 0 represents a, index 1 represents b, -1 an undecided encounter.
        public static Duty AtContact(Encounter a,Encounter b,float wind){
            if(a.turning!=b.turning)return new Duty(a.turning?0:1,21);
            if(a.returning!=b.returning)return new Duty(a.returning?0:1,21);
            if(a.capsized!=b.capsized)return new Duty(a.capsized?1:0,22);
            if(a.tacking!=b.tacking)return new Duty(a.tacking?0:1,13);
            var gap=a.position-b.position;
            var fa=Ocean.Bearing(a.heading);var fb=Ocean.Bearing(b.heading);
            if(a.tacking&&b.tacking){
                float lateral=Vector2.Dot(gap,Ocean.Bearing(b.heading+90));
                return new Duty((Mathf.Abs(lateral)>.75f?lateral<0:Vector2.Dot(gap,fb)<0)?0:1,13);
            }
            float ta=Mathf.DeltaAngle(wind,a.heading),tb=Mathf.DeltaAngle(wind,b.heading);
            if((ta>0)!=(tb>0))return new Duty(ta>0?0:1,10);
            if(Vector2.Dot(fa,fb)<.5f)return new Duty(-1,0);
            float foreA=Vector2.Dot(-gap,fa),foreB=Vector2.Dot(gap,fb);
            float length=(a.length+b.length)/2;
            if(foreA>length*.9f&&foreB<0)return new Duty(0,12);
            if(foreB>length*.9f&&foreA<0)return new Duty(1,12);
            float side=Vector2.Dot(gap,Ocean.Bearing(wind));
            return Mathf.Abs(side)>.06f?new Duty(side>0?0:1,11):new Duty(-1,0);
        }
    }
}
