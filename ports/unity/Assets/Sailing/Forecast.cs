using System;
using System.Collections;
using UnityEngine;
using UnityEngine.Networking;
namespace Sailing {
    public static class Forecast {
        [Serializable] class Reading {
            public float wind_speed_10m,wind_gusts_10m,wind_direction_10m,wave_height,wave_direction,wave_period,sea_level_height_msl,ocean_current_velocity,ocean_current_direction;
        }
        [Serializable] class Units {public string ocean_current_velocity;}
        [Serializable] class Response {public Reading current;public Units current_units;}
        static IEnumerator Read(string url,Action<Response> receive){
            using(var request=UnityWebRequest.Get(url)){
                request.timeout=8;yield return request.SendWebRequest();
                if(request.result!=UnityWebRequest.Result.Success)yield break;
                Response reply=null;
                try{reply=JsonUtility.FromJson<Response>(request.downloadHandler.text);}catch(ArgumentException){}
                if(reply?.current!=null)receive(reply);
            }
        }
        public static IEnumerator Load(string venue,Weather previous,Action<Weather,string> done){
            string pos=venue=="canas"?"latitude=-23.742&longitude=-45.370":venue=="rio"?"latitude=-22.917&longitude=-43.1582":"latitude=-24.001&longitude=-46.334";
            var w=JsonUtility.FromJson<Weather>(JsonUtility.ToJson(previous));bool windOK=false,seaOK=false;
            yield return Read("https://api.open-meteo.com/v1/forecast?"+pos+"&cell_selection=sea&wind_speed_unit=kn&current=wind_speed_10m,wind_gusts_10m,wind_direction_10m",r=>{
                w.wind=r.current.wind_speed_10m;w.dir=venue=="canas"?90:r.current.wind_direction_10m;w.gust=Mathf.Max(w.wind,r.current.wind_gusts_10m);windOK=true;
            });
            yield return Read("https://marine-api.open-meteo.com/v1/marine?"+pos+"&current=wave_height,wave_direction,wave_period,sea_level_height_msl,ocean_current_velocity,ocean_current_direction",r=>{
                var s=r.current;if(s.wave_period<=0)return;
                w.wave=s.wave_height;w.waveDir=s.wave_direction;w.period=s.wave_period;w.tide=s.sea_level_height_msl;
                w.current=s.ocean_current_velocity/(r.current_units?.ocean_current_velocity=="km/h"?3.6f:1);w.currentDir=s.ocean_current_direction;seaOK=true;
            });
            done(w,windOK&&seaOK?"Previsão local · Open-Meteo":windOK?"Vento local · mar manual":seaOK?"Mar local · vento manual":"Previsão indisponível · condições manuais");
        }
    }
}
