using UnityEngine;

namespace Sailing {
    // One captured finger steers while another adjusts the sheet or hikes.
    public sealed class TouchHelm {
        int finger=-1;float center,radius;
        public float Value{get;private set;}
        public void Reset(){finger=-1;Value=0;}
        public void Update(Rect zone){
            for(int i=0;i<Input.touchCount;i++){
                var t=Input.GetTouch(i);var point=new Vector2(t.position.x,Screen.height-t.position.y);
                if(t.phase==TouchPhase.Began&&finger<0&&zone.Contains(point)){
                    finger=t.fingerId;center=point.x;radius=Mathf.Max(20,zone.width*.35f);
                }
                if(t.fingerId!=finger)continue;
                if(t.phase==TouchPhase.Ended||t.phase==TouchPhase.Canceled)Reset();
                else Value=Mathf.Clamp((point.x-center)/radius,-1,1);
            }
            if(Input.touchCount==0)Reset();
        }
    }
}
