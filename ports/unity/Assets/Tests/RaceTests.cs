using NUnit.Framework;
using UnityEngine;
namespace Sailing.Tests {
    public class RaceTests {
        [TestCase(179,"Preparação livre")][TestCase(180,"Procedimento")][TestCase(480,"Regata")]
        public void ClockTransitions(int t,string expected)=>Assert.AreEqual(expected,Regatta.Phase(t));
        [Test] public void EarlyStarterMustReturn(){
            var r=new Regatta(Vector2.zero,0);
            void Step(float t,float u,float v){var a=r.P(u,0);var b=r.P(v,0);r.Step(t,t+1,a,b,a,b);}
            Step(479,-145,-144);Assert.IsTrue(r.ocs);Assert.Zero(r.stage);
            Step(480,-144,-149);Assert.IsFalse(r.ocs);
            Step(481,-149,-147);Assert.AreEqual(1,r.stage);
        }
        [Test] public void CrossingOutsidePinDoesNotCount(){
            var r=new Regatta(Vector2.zero,90);
            Assert.IsFalse(Regatta.Cross(r.P(-150,80),r.P(-145,80),r.P(-148,-69),r.P(-148,69),r.up));
        }
        [TestCase(31,1)][TestCase(10,2)]
        public void ContinuousTurnsPayPenalty(int rule,int turns){
            var r=new Regatta(Vector2.zero,0);r.Penalize(rule);
            for(int i=0;i<360;i+=10)r.Serve(false,i+5,i+15,0);
            Assert.AreEqual(turns,r.turns);
            for(int i=0;i<360*turns;i+=10)r.Serve(true,i+5,i+15,0);
            Assert.Zero(r.turns);
        }
        [Test] public void ThreeLapsAndFinish(){
            var r=new Regatta(Vector2.zero,45);
            void Step(Vector2 a,Vector2 b){r.Step(500,501,a,b,a,b);}
            Step(r.P(-150,0),r.P(-146,0));
            for(int lap=0;lap<3;lap++){
                for(int i=0;i<4;i++){var t=r.Target(r.stage);Step(t-r.up,t);}
                Step(r.P(-96,0),r.P(-100,0));if(lap<2)Step(r.P(-120,24),r.P(-120,28));
            }
            Assert.IsFalse(r.Finished);Assert.AreEqual(18,r.stage);
            r.Penalize(31);Step(r.P(-137,118),r.P(-137,124));Assert.IsFalse(r.Finished);
            for(int i=0;i<360;i+=5)r.Serve(true,i+1,i+6,0);
            Step(r.P(-137,118),r.P(-137,124));Assert.IsTrue(r.Finished);
        }
    }
}
