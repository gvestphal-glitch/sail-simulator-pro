using NUnit.Framework;
using UnityEngine;
namespace Sailing.Tests {
    public class FluidGraphicsTests {
        [Test] public void WaterMatchesBrowserIncludingNorthAxis(){
            var s=new Ocean(new Weather()).At(new Vector2(18,27),3.5f);
            Assert.That(s.height,Is.EqualTo(0.00480217f).Within(.00002));
            Assert.That(s.gradient.y,Is.EqualTo(0.19066800f).Within(.00002));
            Assert.That(s.orbital.x,Is.EqualTo(0.18140158f).Within(.00002));
            Assert.That(s.orbital.y,Is.EqualTo(0.06244445f).Within(.00002));
        }
        [Test] public void SprayMovesWithCurrentAndBoundedOrbitalVelocity(){
            var flow=Wake.Drift(new Weather{current=1,currentDir=90},new Surface{orbital=new Vector2(100,0)});
            Assert.That(flow.x,Is.EqualTo(1.4f).Within(.0001));Assert.That(flow.z,Is.EqualTo(0).Within(.0001));
        }
        [Test] public void ImportedHullHasRenderableColorAndScale(){
            var root=new GameObject();
            try{
                var hull=Visuals.Part("ilca-hull",root.transform,Vector3.zero);
                var mesh=hull.GetComponent<MeshFilter>().sharedMesh;
                Assert.AreEqual(mesh.vertexCount,mesh.colors32.Length);Assert.Greater(mesh.bounds.size.z,4.0f);
                Assert.NotNull(hull.GetComponent<MeshRenderer>().sharedMaterial.shader);
            }finally{Object.DestroyImmediate(root);}
        }
        [Test] public void FlatWaterHasVerticalNormal(){
            var s=new Ocean(new Weather{wave=0,wind=0}).At(Vector2.one,2);
            Assert.AreEqual(Vector3.up,Ocean.Normal(s));Assert.Zero(s.height);Assert.AreEqual(Vector2.zero,s.orbital);
        }
        [Test] public void RenderNormalMatchesDisplacedSurface(){
            var sea=new Ocean(new Weather());var p=new Vector2(4,7);
            float slope=(sea.At(p+Vector2.right*.01f,6).height-sea.At(p-Vector2.right*.01f,6).height)/.02f;
            Assert.That(slope,Is.EqualTo(sea.At(p,6).gradient.x).Within(.0001));
            Assert.That(Ocean.Normal(sea.At(p,6)).magnitude,Is.EqualTo(1).Within(.00001));
        }
        [Test] public void SprayStopsAtRestAndIncreasesWithWind(){
            Assert.Zero(Ocean.SprayRate(0,25));Assert.Greater(Ocean.SprayRate(3,20),Ocean.SprayRate(3,12));
        }
        [TestCase("ilca",40,4.78f)][TestCase("star",175,6.45f)][TestCase("snipe",38,4.98f)][TestCase("optimist",44,3.45f)]
        public void PolarAtTwelveKnots(string id,int angle,float speed){Assert.That(new Helm(id).Knots(12,angle),Is.EqualTo(speed).Within(.001));}
    }
}
