using NUnit.Framework;
using UnityEngine;
namespace Sailing.Tests {
    public class UsabilityBackendTests {
        [TestCase(" abcd234 ","ABCD234",true)][TestCase("abc","ABC",false)]
        public void InviteTyping(string input,string expected,bool valid){
            Assert.AreEqual(expected,Rooms.Code(input));Assert.AreEqual(valid,Rooms.ValidCode(input));
        }
        [Test] public void NameValidation(){Assert.AreEqual("Ana Maria",Rooms.Name(" Ana   Maria "));Assert.IsFalse(Rooms.ValidName("  "));Assert.IsFalse(Rooms.ValidName(new string('a',25)));}
        [Test] public void RudderIsProgressiveAndSymmetric(){
            Assert.Zero(Helm.Steering(.03f));Assert.AreEqual(-Helm.Steering(.6f),Helm.Steering(-.6f));
            Assert.Less(Helm.Steering(.5f),.5f);Assert.That(Helm.Steering(1),Is.EqualTo(1).Within(.00001));
        }
        [Test] public void LegacyRoomReplyReadsServerTimeAndStar(){
            var r=JsonUtility.FromJson<RoomReply>("{\"code\":\"ABC2345\",\"starts\":1800000010000,\"settings\":{\"boatClass\":\"star\"},\"players\":[{\"id\":\"a\",\"seat\":0,\"name\":\"Gui\"}]}");
            Assert.AreEqual(1800000010000L,r.starts);Assert.AreEqual("star",r.settings.boatClass);Assert.AreEqual("Gui",r.players[0].name);
        }
    }
}
