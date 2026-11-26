using UnityEngine;
namespace Sailing {
    public static class Wake {
        // Particles stay in world space after emission and move with local current and wave orbit.
        public static Vector3 Drift(Weather w,Surface sea){
            var flow=Ocean.Bearing(w.currentDir)*w.current+Vector2.ClampMagnitude(sea.orbital*.34f,.4f);
            return new Vector3(flow.x,0,flow.y);
        }
        public static void Apply(ParticleSystem system,Weather w,Surface sea,float speed){
            var emission=system.emission;emission.rateOverTime=Ocean.SprayRate(speed,w.wind);
            var velocity=system.velocityOverLifetime;velocity.enabled=true;velocity.space=ParticleSystemSimulationSpace.World;
            var drift=Drift(w,sea);velocity.x=drift.x;velocity.y=0;velocity.z=drift.z;
        }
    }
}
