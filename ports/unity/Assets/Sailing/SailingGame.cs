using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace Sailing {
    public sealed class SailingGame:MonoBehaviour {
        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        static void Boot(){if(FindFirstObjectByType<SailingGame>()==null)new GameObject("Sail Simulator Pro").AddComponent<SailingGame>();}
        readonly string[] classes={"ilca","snipe","optimist","star"},venues={"central","north","canas","rio"};
        readonly string[] skies={"mixed","clear","cloudy","rain"}; int skyIndex;
        readonly string[] maps={"Baía de Santos","Ponta da Praia","Ponta das Canas","Santos Dumont"};
        readonly Settings settings=new Settings();
        sealed class Yacht {
            public Transform root,main,jib;public SkinnedMeshRenderer crew; public Regatta race;public Vector2 p,v; public float h,rudder,heel,mainAngle,jibAngle;
            public string id,name;public bool remote,down,tacking;public int seat; public bool recover; public float pumpPull;
            public Quaternion rotation=>Quaternion.Euler(0,h,0);
        }
        readonly List<Yacht> fleet=new List<Yacht>();
        MarkRoom markRoom=new MarkRoom();
        readonly HashSet<string> contacts=new HashSet<string>();
        readonly List<Vector2> marks=new List<Vector2>();
        GameObject world; Camera cam; Ocean sea;WaterView water;Helm helm;ParticleSystem spray;
        int selection,venue;float elapsed,clock,steer,main=28,jib=30,waterClock;
        readonly TouchHelm touchHelm=new TouchHelm();
        int orbitFinger=-1;
        float orbitAngle,mouseStart;
        bool orbitingMouse;
        bool InOrbitArea(Vector2 position){
            float fromTop=(Screen.height-position.y)/GuiScale;
            return fromTop>64 && position.y>150*GuiScale &&
                (position.y>250*GuiScale || (position.y>211*GuiScale && position.x<Screen.width-105*GuiScale));
        }
        void OrbitInput(){
            float delta=0;
            for(int i=0;i<Input.touchCount;i++){
                var touch=Input.GetTouch(i);
                if(touch.phase==TouchPhase.Began && orbitFinger<0 && InOrbitArea(touch.position))orbitFinger=touch.fingerId;
                if(touch.fingerId!=orbitFinger)continue;
                if(touch.phase==TouchPhase.Moved)delta=touch.deltaPosition.x;
                if(touch.phase==TouchPhase.Ended || touch.phase==TouchPhase.Canceled)orbitFinger=-1;
            }
            if(Input.touchCount==0){
                orbitFinger=-1;
                if(Input.GetMouseButtonDown(0)){orbitingMouse=InOrbitArea(Input.mousePosition);mouseStart=Input.mousePosition.x;}
                if(!Input.GetMouseButton(0))orbitingMouse=false;
                if(orbitingMouse){delta=Input.mousePosition.x-mouseStart;mouseStart=Input.mousePosition.x;}
            }else orbitingMouse=false;
            orbitAngle=Mathf.Repeat(orbitAngle-delta*360f/Screen.width,360f);
        }
        float GuiScale=>Mathf.Clamp(Screen.width/520f,.7f,2);
        Rect HelmZone=>new Rect(Screen.width*.60f,Screen.height-55*GuiScale,Screen.width*.38f,50*GuiScale);
        bool auto=true,hike,pump,penalty,righting,busy,running;
        string status="",nameInput="",codeInput="",roomCode="",token="",localId="";
        RoomReply latest;float pollAt;
        Vector2 origin=>settings.venue=="north"?new Vector2(1840,925):Vector2.zero;
        static Vector3 World(Vector2 p,float y)=>new Vector3(p.x,y,p.y);
        static float Deg(Vector2 p)=>Mathf.Atan2(p.x,p.y)*Mathf.Rad2Deg;
        Texture2D solutionsLogo,stationLogo;
        void Awake(){
            solutionsLogo=Resources.Load<Texture2D>("sailing-solutions");
            stationLogo=Resources.Load<Texture2D>("sail-station");
            Application.targetFrameRate=60;
            cam=Camera.main;if(!cam){cam=new GameObject("Câmera").AddComponent<Camera>();cam.tag="MainCamera";}
            cam.clearFlags=CameraClearFlags.SolidColor;cam.backgroundColor=new Color(.57f,.76f,.87f);cam.farClipPlane=13000;
            RenderSettings.fog=true;RenderSettings.fogMode=FogMode.ExponentialSquared;RenderSettings.fogDensity=.00016f;
            RenderSettings.fogColor=cam.backgroundColor;RenderSettings.ambientLight=Color.white;
        }
        Yacht AddBoat(int seat,string id,string name,bool remote){
            var race=new Regatta(origin,settings.weather.dir);
            var b=new Yacht{seat=seat,id=id,name=name,remote=remote,race=race,h=settings.weather.dir+(seat%2==0?-51:51),
                p=race.P(-175-13*(seat/5),-57+27*(seat%5)+7*(seat/5))};
            b.root=new GameObject(name).transform;b.root.SetParent(world.transform,false);
            var key=settings.boatClass;
            Visuals.Part(key+"-hull",b.root,Vector3.zero);Visuals.Part(key+"-lines",b.root,Vector3.zero);
            b.crew=Visuals.Crew(key,b.root);
            b.main=Visuals.Part(key+"-main",b.root,new Vector3(0,0,helm.mast)).transform;
            if(helm.jibShare>0)b.jib=Visuals.Part(key+"-jib",b.root,new Vector3(0,0,key=="star"?3.23f:2.27f)).transform;
            b.root.position=World(b.p,0);fleet.Add(b);return b;
        }
        void Mark(Vector2 p,Color color,float scale){
            var obj=GameObject.CreatePrimitive(PrimitiveType.Cylinder);obj.transform.SetParent(world.transform,false);
            obj.transform.position=World(p,.65f);obj.transform.localScale=new Vector3(scale,.78f,scale);
            obj.GetComponent<Renderer>().material.color=color;
        }
        void Enter(float at=0){
            helm=new Helm(settings.boatClass);sea=new Ocean(settings.weather);world=new GameObject("Regata");
            cam.backgroundColor=settings.sky=="rain"?Color.gray:new Color(.57f,.76f,.87f);
            Visuals.Part(settings.venue=="north"||settings.venue=="central"?"santos":settings.venue,world.transform,Vector3.zero);
            water=new WaterView(world.transform);var race=new Regatta(origin,settings.weather.dir);
            marks.Clear();marks.AddRange(new[]{race.P(Regatta.WindwardAlong,0),race.P(Regatta.WindwardAlong,-24),race.P(-98,-22),race.P(-98,22)});
            foreach(var m in marks)Mark(m,new Color(1,.47f,.04f),.95f);
            Mark(race.P(-148,-69),Color.yellow,1.3f);Mark(race.P(-118,133),Color.yellow,1.3f);
            void Committee(Vector2 location,Vector2 normal){
                var cr=Visuals.Part("committee",world.transform,Vector3.zero).transform;
                cr.SetPositionAndRotation(World(location,0),Quaternion.Euler(0,Deg(normal),0));
            }
            Committee(race.P(-148,69),race.up);Committee(race.P(-156,109),(38*race.right-24*race.up).normalized);
            if(latest==null){for(int i=0;i<6;i++)AddBoat(i,"bot"+i,i==0?"Você":"Barco "+i,false);}
            else{
                var own=Array.Find(latest.players,p=>p.id==localId);
                AddBoat(own.seat,own.id,own.name,false);
                foreach(var member in latest.players)if(member.id!=localId)AddBoat(member.seat,member.id,member.name,true);
            }
            var stern=new GameObject("Esteira");stern.transform.SetParent(fleet[0].root,false);stern.transform.localPosition=new Vector3(0,.04f,-helm.length*.46f);
            spray=stern.AddComponent<ParticleSystem>();spray.Stop(true,ParticleSystemStopBehavior.StopEmittingAndClear);
            var particles=spray.main;particles.simulationSpace=ParticleSystemSimulationSpace.World;particles.startLifetime=2.2f;particles.startSize=.14f;particles.startSpeed=.25f;
            particles.startColor=new Color(.74f,.94f,.92f,.62f);particles.gravityModifier=.012f;
            var shape=spray.shape;shape.shapeType=ParticleSystemShapeType.Sphere;shape.radius=.18f;spray.Play();
            var emission=spray.emission;emission.rateOverTime=0;
            markRoom=new MarkRoom();cam.transform.position=fleet[0].root.position+fleet[0].rotation*new Vector3(2,4,-10);clock=0;elapsed=at;waterClock=0;steer=0;contacts.Clear();running=true;status="";
        }
        void FixedUpdate(){
            if(!running)return;
            float dt=Time.fixedDeltaTime;clock+=dt;elapsed+=dt;
            var w=settings.weather;
            foreach(var b in fleet){
                if(b.remote||b.race.Finished)continue;
                var before=b.p;float oldH=b.h;
                var forward=Ocean.Bearing(b.h);float surge=Vector2.Dot(b.v,forward);
                var target=b.race.Target(b.race.stage,b.seat%2==0?-1:1);
                if(b.seat>0&&b.race.stage==0){
                    float side=Vector2.Dot(b.p-origin,b.race.up)+148;
                    if(side>1)b.recover=true;if(side< -20)b.recover=false;
                    target=b.race.P(elapsed<465||b.recover?-178:-125,-48+19*b.seat+8*Mathf.Sin(clock*.15f+b.seat));
                }
                float desired=Deg(target-b.p);
                if(Mathf.Abs(Mathf.DeltaAngle(w.dir,desired))<41)desired=w.dir+(Vector2.Dot(target-b.p,b.race.right)>0?42:-42);
                bool own=b==fleet[0];
                float command=own?Helm.Steering(steer):Mathf.Clamp(Mathf.DeltaAngle(b.h,desired)/30,-1,1);
                if(!own&&b.race.turns>0)command=1;
                b.rudder=Mathf.Lerp(b.rudder,command,1-Mathf.Exp(-dt*11));
                float gust=Ocean.Gust(b.p,w.dir,clock,w.wind);
                float localWind=w.wind+Mathf.Max(0,w.gust-w.wind)*gust;
                var wind=Ocean.Bearing(w.dir)*localWind*.514444f+b.v;
                float awa=Mathf.DeltaAngle(b.h,Deg(wind)),twa=Mathf.Abs(Mathf.DeltaAngle(b.h,w.dir));
                float ideal=Mathf.Clamp01((Mathf.Abs(awa)-30)/76)*100, sheet=!own||auto?ideal:main;
                float jibIdeal=Mathf.Clamp01((Mathf.Abs(awa)-29)/60)*100,jibSheet=!own||auto?jibIdeal:jib;
                float efficiency=(1-helm.jibShare)*Mathf.Exp(-6*Mathf.Pow((sheet-ideal)/100,2))+helm.jibShare*Mathf.Exp(-6*Mathf.Pow((jibSheet-jibIdeal)/100,2));
                var surface=sea.At(b.p,clock);
                b.mainAngle=Mathf.Sign(awa)*(6+.81f*sheet);b.jibAngle=Mathf.Sign(awa)*(4+.78f*jibSheet);
                float previousPull=b.pumpPull;b.pumpPull=Mathf.MoveTowards(previousPull,own&&pump?1:0,dt/(own&&pump?.2f:.18f));
                b.mainAngle*=1-.4f*b.pumpPull;
                float speedTarget=helm.Knots(localWind,twa)*.514444f*efficiency;
                float roll=-Mathf.Sign(awa)*Mathf.Min(85,w.wind*w.wind*.077f)*Mathf.Abs(Mathf.Sin(awa*Mathf.Deg2Rad))*(own&&hike?.55f:.90f);
                if(!b.down && settings.boatClass!="star" && Mathf.Abs(b.heel)>55)b.down=true;
                if(b.down){
                    speedTarget=0;roll=Mathf.Sign(b.heel)*88;
                    if(!own||righting){b.down=false;b.h=w.dir+68;b.heel=0;roll=0;righting=false;}
                }
                b.heel=Mathf.Lerp(b.heel,roll,1-Mathf.Exp(-dt*1.8f));
                float stroke=.15f*Mathf.Max(0,b.pumpPull-previousPull)*Mathf.InverseLerp(125,150,twa)*(1-Mathf.InverseLerp(7,12,localWind));
                float speed=Mathf.Max(0,surge+helm.Acceleration(speedTarget,surge,b.rudder)*dt+(settings.boatClass=="star"?0:stroke));
                b.h+=b.rudder*(.565f+.30f*b.rudder*b.rudder)*Mathf.Clamp01(speed/1.65f)*helm.turnGain*Mathf.Rad2Deg*dt;
                float previousTack=Mathf.DeltaAngle(w.dir,oldH),nextTack=Mathf.DeltaAngle(w.dir,b.h);
                if(Mathf.Sign(previousTack)!=Mathf.Sign(nextTack)&&Mathf.Abs(nextTack)<90)b.tacking=true;
                if(Mathf.Abs(nextTack)>=37)b.tacking=false;
                b.v=Ocean.Bearing(b.h)*speed;
                b.p+=(b.v+Ocean.Bearing(w.currentDir)*w.current+Vector2.ClampMagnitude(surface.orbital*.34f,.4f))*dt;
                b.race.Step(elapsed-dt,elapsed,before,b.p,before+Ocean.Bearing(oldH)*helm.length*.5f,b.p+Ocean.Bearing(b.h)*helm.length*.5f);
                b.race.Serve(!b.down&&(own?penalty:b.race.turns>0),oldH,b.h,w.dir);
                if(elapsed>=180)for(int i=0;i<marks.Count;i++){
                    string key=b.id+":"+i;
                    if(Vector2.Distance(b.p,marks[i])<helm.length*.40f){if(contacts.Add(key))b.race.Penalize(31);}else contacts.Remove(key);
                }
                if(own)Wake.Apply(spray,w,surface,speed);
                Pose(b,surface);
            }
            if(elapsed>=180)for(int i=0;i<fleet.Count;i++)for(int j=i+1;j<fleet.Count;j++){
                var a=fleet[i];var b=fleet[j];string key="pair"+i+"-"+j;
                Encounter Snapshot(Yacht y)=>new Encounter(y.p,y.h,helm.length){turning=y.race.turns>0&&(y==fleet[0]?penalty:true),returning=y.race.ocs,tacking=y.tacking,capsized=y.down};
                int MarkIndex(Yacht y){
                    if(y.race.stage==0||y.race.stage>=18)return -1;
                    int leg=(y.race.stage-1)%6;
                    return leg<2?0:leg<4?1:Vector2.Dot(y.p-origin,y.race.right)<0?2:3;
                }
                var sa=Snapshot(a);var sb=Snapshot(b);
                int pair=i*6+j, mark=MarkIndex(a),owner=-1;
                if(mark>=0&&mark==MarkIndex(b))owner=markRoom.Update(pair,mark,marks[mark],sa,sb,w.dir,helm.id=="star"?1.734f:helm.id=="snipe"?1.524f:helm.id=="optimist"?1.13f:1.37f);
                else markRoom.Forget(pair);
                if(!HullContact(a,b)){contacts.Remove(key);continue;}
                if(!contacts.Add(key))continue;
                var duty=owner<0?Passage.AtContact(sa,sb,w.dir):new Duty(1-owner,18);
                var liable=duty.boat==0?a:b;
                if(duty.boat>=0&&!liable.remote)liable.race.Penalize(duty.rule);
            }
        }
        bool HullContact(Yacht a,Yacht b){
            if(Vector2.Distance(a.p,b.p)>helm.length+1)return false;
            var f=Ocean.Bearing(a.h)*helm.length*.33f;var g=Ocean.Bearing(b.h)*helm.length*.33f;
            float radius=helm.id=="optimist"?.48f:helm.id=="star"?.76f:.61f;
            for(int i=-1;i<=1;i++)for(int j=-1;j<=1;j++)if((a.p+i*f-b.p-j*g).sqrMagnitude<4*radius*radius)return true;
            return false;
        }
        void Pose(Yacht b,Surface s){
            float twa=Mathf.Abs(Mathf.DeltaAngle(settings.weather.dir,b.h));
            float stand=settings.boatClass=="star"?Mathf.InverseLerp(126,153,twa):0;
            b.crew.SetBlendShapeWeight(0,(1-stand)*(b==fleet[0]&&hike?100:Mathf.InverseLerp(6,20,settings.weather.wind)*65));
            if(settings.boatClass=="star")b.crew.SetBlendShapeWeight(1,stand*100);
            float side=Mathf.Sign(Mathf.DeltaAngle(b.h,settings.weather.dir));
            b.crew.transform.localScale=new Vector3((settings.weather.wind<5?-side:side),1,1);
            b.root.position=World(b.p,s.height);b.root.rotation=b.rotation*Quaternion.Euler(-Mathf.Atan(Vector2.Dot(s.gradient,Ocean.Bearing(b.h)))*Mathf.Rad2Deg,0,b.heel);
            b.main.localRotation=Quaternion.Euler(0,b.mainAngle,0);
            if(b.jib)b.jib.localRotation=Quaternion.Euler(0,b.jibAngle,0);
        }
        void Update(){
            if(roomCode!=""&&!busy&&Time.unscaledTime>=pollAt)Send("sync");
            if(!running)return;
            if(Input.touchSupported){touchHelm.Update(HelmZone);steer=touchHelm.Value;}
            else{steer=(Input.GetKey(KeyCode.RightArrow)?1:0)-(Input.GetKey(KeyCode.LeftArrow)?1:0);hike=Input.GetKey(KeyCode.Space);pump=Input.GetKey(KeyCode.B);penalty=Input.GetKey(KeyCode.P);}
            if(Input.GetKeyDown(KeyCode.V))righting=true;
            var b=fleet[0];float back=settings.boatClass=="star"?13:9;
            OrbitInput();
            var target=b.root.position+b.rotation*Quaternion.AngleAxis(orbitAngle,Vector3.up)*new Vector3(back*.23f,back*.36f,-back);
            cam.transform.position=Vector3.Lerp(cam.transform.position,target,1-Mathf.Exp(-Time.deltaTime*9));
            cam.transform.LookAt(b.root.position+Vector3.up*(back*.21f)+b.root.forward*(1+Mathf.Cos(orbitAngle*Mathf.Deg2Rad)));
            if(clock>=waterClock){water.Draw(sea,b.p,clock);waterClock=clock+.05f;}
        }
        void Send(string action){
            if(busy)return;
            if((action=="create"||action=="join")&&!Rooms.ValidName(nameInput)){status="Digite seu nome (1–24 caracteres).";return;}
            if(action=="join"&&!Rooms.ValidCode(codeInput)){status="Digite os 7 caracteres da sala.";return;}
            busy=true;
            var req=new RoomRequest{name=Rooms.Name(nameInput),code=roomCode==""?Rooms.Code(codeInput):roomCode,token=token};
            if(action=="create"||action=="start")req.settings=settings;
            if(action=="sync"&&running){var b=fleet[0];req.boat=new BoatPacket{x=b.p.x,y=-b.p.y,h=Mathf.DeltaAngle(0,b.h)*Mathf.Deg2Rad,vx=b.v.x,vy=-b.v.y,speed=b.v.magnitude,waterSpeed=b.v.magnitude,
                heel=b.heel*Mathf.Deg2Rad,heave=b.root.position.y,main=main,jib=jib,stage=b.race.stage,mainAngle=b.mainAngle*Mathf.Deg2Rad,jibAngle=b.jibAngle*Mathf.Deg2Rad,downSide=b.down?1:0};}
            StartCoroutine(Rooms.Post(action,req,reply=>{
                busy=false;pollAt=Time.unscaledTime+(running?.25f:1);status="";
                if(action=="leave"){Exit();return;}
                if(!string.IsNullOrEmpty(reply.token)){token=reply.token;localId=reply.id;}
                roomCode=reply.code;latest=reply;
                if(!running&&reply.starts>0){
                    settings.venue=reply.settings.venue;settings.weather=reply.settings.weather;settings.boatClass=reply.settings.boatClass;settings.sky=reply.settings.sky;
                    Enter(480+(reply.now-reply.starts)/1000f);
                }
                if(running)foreach(var member in reply.players){
                    if(member.id==localId)continue;var boat=fleet.Find(x=>x.id==member.id);if(boat==null)continue;
                    boat.root.gameObject.SetActive(member.online);
                    var p=member.boat;if(p==null)continue;boat.p=new Vector2(p.x,-p.y);boat.h=p.h*Mathf.Rad2Deg;boat.heel=p.heel*Mathf.Rad2Deg;
                    boat.mainAngle=p.mainAngle*Mathf.Rad2Deg;boat.jibAngle=p.jibAngle*Mathf.Rad2Deg;Pose(boat,new Surface{height=p.heave});
                }
            },(code,msg)=>{busy=false;pollAt=Time.unscaledTime+2;if(code==404||action=="leave")Exit();status=msg;}));
        }
        void OnApplicationFocus(bool focused){if(!focused){touchHelm.Reset();steer=0;hike=pump=penalty=false;}}
        void Exit(){orbitFinger=-1;orbitAngle=0;orbitingMouse=false;touchHelm.Reset();if(world){foreach(var boat in fleet)if(boat.crew)Destroy(boat.crew.sharedMesh);water?.Dispose();Destroy(world);}running=false;fleet.Clear();roomCode=token=localId="";latest=null;righting=pump=hike=penalty=false;}
        void OnGUI(){
            float scale=GuiScale;GUI.matrix=Matrix4x4.Scale(new Vector3(scale,scale,1));
            float width=Screen.width/scale,height=Screen.height/scale;
            if(!running){
                GUILayout.BeginArea(new Rect(10,10,Mathf.Min(480,width-20),height-15),GUI.skin.box);
                GUILayout.BeginHorizontal();
                GUILayout.Label("Sail Simulator Pro",GUILayout.ExpandWidth(false));
                GUILayout.Label(solutionsLogo,GUILayout.Width(84),GUILayout.Height(29));
                GUILayout.Label("+",GUILayout.Width(14));
                GUILayout.Label(stationLogo,GUILayout.Width(40),GUILayout.Height(37));
                GUILayout.EndHorizontal();
                if(roomCode==""){
                    selection=GUILayout.SelectionGrid(selection,classes,4);venue=GUILayout.SelectionGrid(venue,maps,2);
                    settings.boatClass=classes[selection];settings.venue=venues[venue];
                    GUILayout.Label("Vento "+settings.weather.wind.ToString("0")+" nós");settings.weather.wind=GUILayout.HorizontalSlider(settings.weather.wind,0,40);
                    settings.weather.dir=venue==2?90:settings.weather.dir;settings.weather.gust=Mathf.Max(settings.weather.wind,settings.weather.wind*1.2f);
                    GUILayout.Label("Direção do vento "+settings.weather.dir.ToString("0")+"°");if(venue!=2)settings.weather.dir=GUILayout.HorizontalSlider(settings.weather.dir,0,359);
                    GUILayout.Label("Direção da ondulação "+settings.weather.waveDir.ToString("0")+"°");settings.weather.waveDir=GUILayout.HorizontalSlider(settings.weather.waveDir,0,359);
                    skyIndex=GUILayout.SelectionGrid(skyIndex,new[]{"Variável","Limpo","Nublado","Chuva"},4);settings.sky=skies[skyIndex];
                    GUILayout.Label("Maré "+settings.weather.tide.ToString("0.0")+" m");settings.weather.tide=GUILayout.HorizontalSlider(settings.weather.tide,-2,2);
                    GUILayout.Label("Ondulação "+settings.weather.wave.ToString("0.0")+" m");settings.weather.wave=GUILayout.HorizontalSlider(settings.weather.wave,0,4);
                    GUI.enabled=!busy;if(GUILayout.Button("Carregar previsão local")){
                        string selected=settings.venue;busy=true;
                        StartCoroutine(Forecast.Load(selected,settings.weather,(w,msg)=>{busy=false;if(settings.venue==selected){settings.weather=w;status=msg;}}));
                    }
                    if(GUILayout.Button("Entrar na raia"))Enter();
                    GUILayout.Label("Jogue com os amigos");GUILayout.Label("Nome");nameInput=GUILayout.TextField(nameInput,24);
                    GUILayout.Label("Código");codeInput=GUILayout.TextField(codeInput,7);
                    if(GUILayout.Button("Criar sala"))Send("create");if(GUILayout.Button("Entrar com código"))Send("join");GUI.enabled=true;
                }else{
                    GUILayout.Label("Sala "+roomCode);foreach(var p in latest.players)GUILayout.Label(p.name);
                    GUI.enabled=!busy;if(Array.Exists(latest.players,p=>p.id==localId&&p.seat==0)&&GUILayout.Button("Iniciar regata"))Send("start");
                    if(GUILayout.Button("Sair"))Send("leave");GUI.enabled=true;
                }
                GUILayout.Label(status);GUILayout.EndArea();return;
            }
            var b=fleet[0];
            GUI.Box(new Rect(5,4,width-94,32),elapsed<480?"Prepare-se a sotavento da linha":b.race.Objective());
            float windWidth=Mathf.Min(185,width*.34f),chartWidth=Mathf.Min(100,width*.24f);
            float timerLeft=windWidth+10,timerWidth=width-chartWidth-10-timerLeft;
            float remaining=elapsed<180?180-elapsed:elapsed<480?480-elapsed:elapsed-480;
            GUI.Box(new Rect(timerLeft,height-209,timerWidth,53),Regatta.Phase(elapsed)+"\n"+TimeSpan.FromSeconds(remaining).ToString(@"mm\:ss"));
            GUI.Label(new Rect(6,39,width-96,25),(b.v.magnitude/.514444f).ToString("0.0")+" nós   "+Mathf.Repeat(b.h,360).ToString("0")+"°   DTW "+Vector2.Distance(b.p,b.race.Target(b.race.stage)).ToString("0")+" m");
            var apparent=Ocean.Bearing(settings.weather.dir)*settings.weather.wind*.514444f+b.v;
            float awa=Mathf.DeltaAngle(b.h,Deg(apparent)),twa=Mathf.DeltaAngle(b.h,settings.weather.dir);
            GUI.Box(new Rect(5,height-211,windWidth,55),"Aparente "+Mathf.Abs(awa).ToString("0")+"° "+(awa>=0?"BE":"BB")+"   "+(apparent.magnitude/.514444f).ToString("0.0")+" nós\nReal "+Mathf.Abs(twa).ToString("0")+"° "+(twa>=0?"BE":"BB")+"   "+settings.weather.wind.ToString("0.0")+" nós");
            var chart=new Rect(width-chartWidth-5,height-250,chartWidth,94);GUI.Box(chart,"Raia");
            Vector2 OnChart(Vector2 p)=>new Vector2(chart.center.x+Vector2.Dot(p-origin,b.race.right)*.26f,chart.center.y-Vector2.Dot(p-origin,b.race.up)*.24f);
            foreach(var mark in marks){var pt=OnChart(mark);GUI.Label(new Rect(pt.x-4,pt.y-9,16,18),"•");}
            foreach(var sailor in fleet){var pt=OnChart(sailor.p);if(chart.Contains(pt))GUI.Label(new Rect(pt.x-3,pt.y-8,16,18),sailor==b?"▲":"·");}
            GUI.enabled=!busy;if(GUI.Button(new Rect(width-80,4,75,36),"Menu")){if(roomCode!="")Send("leave");else Exit();}GUI.enabled=true;
            foreach(var other in fleet)if(other!=b&&other.root.gameObject.activeSelf){
                var p=cam.WorldToScreenPoint(other.root.position+Vector3.up*4);if(p.z>0)GUI.Label(new Rect(p.x/scale-36,height-p.y/scale,100,22),other.name);
            }
            GUILayout.BeginArea(new Rect(6,height-150,width-12,147),GUI.skin.box);
            GUILayout.Label(b.race.ocs?"OCS · volte à linha":b.race.turns>0?"Penalidade · "+b.race.turns+" giro(s)":status);
            GUILayout.BeginHorizontal();auto=GUILayout.Toggle(auto,"Auto trim");GUILayout.Label("Main");main=GUILayout.HorizontalSlider(main,0,100,GUILayout.MinWidth(70));
            if(helm.jibShare>0){GUILayout.Label("Jib");jib=GUILayout.HorizontalSlider(jib,0,100,GUILayout.MinWidth(55));}GUILayout.EndHorizontal();
            GUILayout.BeginHorizontal();if(Input.touchSupported){
                hike=GUILayout.RepeatButton("Escora");pump=GUILayout.RepeatButton("Bombar");penalty=GUILayout.RepeatButton("P");
                GUILayout.FlexibleSpace();
            }else GUILayout.Label("← → leme  ·  Espaço escora  ·  B bombar  ·  P giro  ·  V desvirar");
            if(b.down&&GUILayout.Button("Desvirar"))righting=true;GUILayout.EndHorizontal();GUILayout.EndArea();
            if(Input.touchSupported){var rect=HelmZone;GUI.Box(new Rect(rect.x/scale,rect.y/scale,rect.width/scale,rect.height/scale),"Leme "+Mathf.RoundToInt(steer*100)+"%");}
        }
    }
}
