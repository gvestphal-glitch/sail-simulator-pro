using NUnit.Framework;
using UnityEngine;
namespace Sailing.Tests {
 public class PassageTests {
    [Test] public void MarkRoomRemembersInsideBoat(){
        var zone=new MarkRoom();var a=new Encounter(Vector2.up,135,4);var b=new Encounter(Vector2.right*2,138,4);
        Assert.AreEqual(0,zone.Update(1,0,Vector2.zero,a,b,0,1.4f));
        a.position=Vector2.right*3;b.position=Vector2.up;
        Assert.AreEqual(0,zone.Update(1,0,Vector2.zero,a,b,0,1.4f));
        a.position=b.position=Vector2.one*30;Assert.AreEqual(-1,zone.Update(1,0,Vector2.zero,a,b,0,1.4f));
    }
    [Test] public void PortBoatKeepsClear(){var d=Passage.AtContact(new Encounter(Vector2.zero,45,4),new Encounter(Vector2.one,-45,4),0);Assert.AreEqual(0,d.boat);Assert.AreEqual(10,d.rule);}
    [Test] public void TurningDutyBeforeTackPriority(){var d=Passage.AtContact(new Encounter(Vector2.zero,45,4),new Encounter(Vector2.one,-45,4){turning=true},0);Assert.AreEqual(1,d.boat);Assert.AreEqual(21,d.rule);}
    [Test] public void ClearAsternKeepsClear(){var d=Passage.AtContact(new Encounter(Vector2.zero,90,4),new Encounter(Vector2.right*4,90,4),0);Assert.AreEqual(0,d.boat);Assert.AreEqual(12,d.rule);}
    [Test] public void WindwardKeepsClear(){var d=Passage.AtContact(new Encounter(Vector2.up,90,4),new Encounter(Vector2.zero,90,4),0);Assert.AreEqual(0,d.boat);Assert.AreEqual(11,d.rule);}
 }
}
