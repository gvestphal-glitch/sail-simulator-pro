using System;
using System.Collections;
using System.Text;
using System.Text.RegularExpressions;
using UnityEngine;
using UnityEngine.Networking;

namespace Sailing {
    [Serializable] public class Settings {public string venue="central",boatClass="ilca",sky="mixed";public bool windShift;public Weather weather=new Weather();}
    [Serializable] public class BoatPacket {
        public float x,y,h,vx,vy,speed,waterSpeed,heel,pitch,heave,rudderAngle,downSide,stage,main,jib,mainAngle,jibAngle,crewPose,extraHike;
    }
    [Serializable] public class Sailor {public string id,name;public int seat; public bool online;public BoatPacket boat;}
    [Serializable] public class RoomReply {public string code,id,token,error;public long starts,now;public Settings settings;public Sailor[] players;}
    [Serializable] public class RoomRequest {public string name,code,token;public Settings settings;public BoatPacket boat;}
    public static class Rooms {
        public static string Name(string name)=>Regex.Replace((name??"").Trim(),@"\s+"," ");
        public static bool ValidName(string s)=>Name(s).Length>0&&Name(s).Length<=24&&!Regex.IsMatch(Name(s),@"[\p{Cc}\p{Cf}]");
        public static string Code(string code)=>(code??"").Trim().ToUpperInvariant();
        public static bool ValidCode(string code)=>Regex.IsMatch(Code(code),"^[A-Z2-9]{7}$");
        public static IEnumerator Post(string action,RoomRequest data,Action<RoomReply> done,Action<int,string> fail){
            const string production="https://santos-sail.guilherme279095.chatgpt.site";
            string origin=Application.platform==RuntimePlatform.WebGLPlayer && Uri.TryCreate(Application.absoluteURL,UriKind.Absolute,out var page)
                ?page.GetLeftPart(UriPartial.Authority):production;
            using(var q=new UnityWebRequest(origin+"/api/rooms/"+action,"POST")){
                q.uploadHandler=new UploadHandlerRaw(Encoding.UTF8.GetBytes(JsonUtility.ToJson(data)));
                q.downloadHandler=new DownloadHandlerBuffer();q.SetRequestHeader("Content-Type","application/json");q.timeout=7;
                yield return q.SendWebRequest();
                RoomReply reply=null;
                try{reply=JsonUtility.FromJson<RoomReply>(q.downloadHandler.text);}catch(ArgumentException){}
                if(q.result!=UnityWebRequest.Result.Success||reply==null)fail((int)q.responseCode,reply?.error??"Conexão indisponível.");
                else done(reply);
            }
        }
    }
}
