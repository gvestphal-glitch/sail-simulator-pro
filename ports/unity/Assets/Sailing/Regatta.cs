using UnityEngine;

namespace Sailing {
    public class Regatta {
        public const float WindwardAlong=-148+180;
        public int stage {get;private set;}
        public int turns {get;private set;}
        public bool ocs {get;private set;}
        public bool Finished=>stage==19;
        public readonly Vector2 up, right, origin;
        float sweep,reverse; int direction;bool tack,gybe;
        public Regatta(Vector2 start,float wind){origin=start;up=Ocean.Bearing(wind);right=new Vector2(up.y,-up.x);}
        public Vector2 P(float along,float cross)=>origin+up*along+right*cross;
        public static string Phase(float elapsed)=>elapsed<180?"Preparação livre":elapsed<480?"Procedimento":"Regata";
        public static bool Cross(Vector2 old,Vector2 now,Vector2 a,Vector2 b,Vector2 n){
            float before=Vector2.Dot(old-a,n),after=Vector2.Dot(now-a,n);
            if(before>=0||after<0)return false;
            var line=b-a;
            float t=Vector2.Dot(Vector2.Lerp(old,now,-before/(after-before))-a,line)/line.sqrMagnitude;
            return t>=0&&t<=1;
        }
        public string Objective(){
            if(ocs)return "OCS · volte a sotavento da linha";
            if(Finished)return "Regata concluída";
            if(stage==0)return "Cruze a linha de largada";
            if(stage==18)return "Cruze a linha de chegada";
            switch((stage-1)%6){
                case 0:case 1:return "Deixe a boia 1 por bombordo";
                case 2:case 3:return "Deixe a boia 1A por bombordo";
                case 4:return "Passe entre 2S e 2P";
                default:return "Contorne 2S ou 2P pelo lado de fora";
            }
        }
        public Vector2 Target(int index,int side=1){
            if(index==0)return P(-148,0);
            if(index>=18)return P(-137,121);
            switch((index-1)%6){
                case 0:return P(WindwardAlong,18);case 1:return P(WindwardAlong+16,9);case 2:return P(WindwardAlong+16,-24);
                case 3:return P(WindwardAlong,-41);case 4:return P(-98,0);default:return P(-111,side*34);
            }
        }
        public void Step(float beforeTime,float nowTime,Vector2 old,Vector2 now,Vector2 oldBow,Vector2 bow){
            if(Finished||nowTime<480)return;
            if(stage==0){
                if(beforeTime<480){
                    float f=Mathf.InverseLerp(beforeTime,nowTime,480);
                    oldBow=Vector2.Lerp(oldBow,bow,f);
                    ocs=Vector2.Dot(oldBow-P(-148,0),up)>=0;
                }
                if(Vector2.Dot(bow-P(-148,0),up)<0)ocs=false;
                if(!ocs&&Cross(oldBow,bow,P(-148,-69),P(-148,69),up))stage++;
            }else if(stage==18){
                if(turns==0&&Cross(old,now,P(-156,109),P(-118,133),(38*right-24*up).normalized))stage++;
            }else{
                int leg=(stage-1)%6;
                bool done=leg<4?Vector2.Distance(now,Target(stage))<13:
                    leg==4?Cross(old,now,P(-98,-22),P(-98,22),-up):
                    Cross(old,now,P(-174,26),P(-100,26),right)||Cross(old,now,P(-174,-26),P(-100,-26),-right);
                if(done)stage++;
            }
        }
        public void Penalize(int rule){turns+=rule==31?1:2;}
        void ResetTurn(){direction=0;sweep=reverse=0;tack=gybe=false;}
        public void Serve(bool held,float old,float now,float wind){
            if(!held||turns==0){ResetTurn();return;}
            float delta=Mathf.DeltaAngle(old,now);
            if(Mathf.Abs(delta)<.0001f)return;
            if(direction==0)direction=delta>0?1:-1;
            float advance=delta*direction;
            if(advance<0){sweep=Mathf.Max(0,sweep+advance);reverse-=advance;if(reverse>12)ResetTurn();return;}
            reverse=0;sweep+=advance;
            float a=Mathf.DeltaAngle(wind,old),b=Mathf.DeltaAngle(wind,now);
            if((a<0)!=(b<0)){if(Mathf.Abs(a)<90)tack=true;else gybe=true;}
            if(sweep>=359.999f&&tack&&gybe){turns--;ResetTurn();}
        }
    }
}
