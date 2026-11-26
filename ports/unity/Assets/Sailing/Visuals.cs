using System.IO;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace Sailing {
    public static class Visuals {
        static readonly Dictionary<string,Mesh> cache=new Dictionary<string,Mesh>();
        public static Material Material {get {
            if(material==null)material=new Material(Resources.Load<Shader>("SailSurface"));
            return material;
        }}
        static Material material;
        public static SkinnedMeshRenderer Crew(string key,Transform parent){
            var obj=Part(key+"-crew",parent,Vector3.zero);
            var filter=obj.GetComponent<MeshFilter>();var mesh=Object.Instantiate(filter.sharedMesh);var source=mesh.vertices;
            foreach(var pose in key=="star"?new[]{"hike","mast"}:new[]{"hike"}){
                var target=Part(key+"-crew-"+pose,parent,Vector3.zero);
                var vertices=target.GetComponent<MeshFilter>().sharedMesh.vertices;
                if(vertices.Length!=source.Length)throw new InvalidDataException("Crew topology: "+pose);
                for(int i=0;i<vertices.Length;i++)vertices[i]-=source[i];
                mesh.AddBlendShapeFrame(pose,100,vertices,null,null);
                target.SetActive(false);Object.Destroy(target);
            }
            var result=new GameObject("Tripulação").AddComponent<SkinnedMeshRenderer>();
            result.transform.SetParent(parent,false);result.sharedMesh=mesh;result.sharedMaterial=Material;result.updateWhenOffscreen=true;
            obj.SetActive(false);Object.Destroy(obj);return result;
        }
        public static GameObject Part(string key,Transform parent,Vector3 pivot){
            if(!cache.TryGetValue(key,out var mesh)){
                using(var reader=new BinaryReader(new MemoryStream(Resources.Load<TextAsset>("Models/"+key).bytes))){
                    int n=reader.ReadInt32();var vertices=new Vector3[n];var colors=new Color32[n];var indices=new int[n];
                    for(int i=0;i<n;i++){
                        vertices[i]=new Vector3(reader.ReadSingle(),reader.ReadSingle(),reader.ReadSingle())-pivot;
                        colors[i]=new Color32(reader.ReadByte(),reader.ReadByte(),reader.ReadByte(),reader.ReadByte());indices[i]=i;
                    }
                    mesh=new Mesh{name=key,indexFormat=n>65535?IndexFormat.UInt32:IndexFormat.UInt16};
                    mesh.vertices=vertices;mesh.colors32=colors;mesh.triangles=indices;cache[key]=mesh;
                }
            }
            var obj=new GameObject(key);obj.transform.SetParent(parent,false);obj.transform.localPosition=pivot;
            obj.AddComponent<MeshFilter>().sharedMesh=mesh;obj.AddComponent<MeshRenderer>().sharedMaterial=Material;return obj;
        }
    }
    public sealed class WaterView {
        const int N=65;
        readonly Mesh mesh=new Mesh();
        readonly Vector3[] vertices=new Vector3[N*N];
        readonly Color32[] colors=new Color32[N*N];
        public WaterView(Transform parent){
            var obj=new GameObject("Superfície");obj.transform.SetParent(parent,false);
            obj.AddComponent<MeshFilter>().sharedMesh=mesh;obj.AddComponent<MeshRenderer>().sharedMaterial=Visuals.Material;
            int[] triangles=new int[(N-1)*(N-1)*6];int k=0;
            for(int z=0;z<N-1;z++)for(int x=0;x<N-1;x++){
                int i=z*N+x;triangles[k++]=i;triangles[k++]=i+N;triangles[k++]=i+1;
                triangles[k++]=i+1;triangles[k++]=i+N;triangles[k++]=i+N+1;
            }
            mesh.MarkDynamic();mesh.vertices=vertices;mesh.triangles=triangles;
        }
        public void Dispose()=>Object.Destroy(mesh);
        public void Draw(Ocean sea,Vector2 center,float clock){
            float Offset(int i){float v=(i-32)/32f;return v*(40+Mathf.Pow(Mathf.Abs(v),5)*2500);}
            for(int j=0;j<N;j++)for(int i=0;i<N;i++){
                var p=center+new Vector2(Offset(i),Offset(j));var s=sea.At(p,clock);
                float light=Mathf.Clamp01(.48f+1.7f*s.gradient.x+s.gradient.y);
                vertices[j*N+i]=new Vector3(p.x,s.height,p.y);
                var waterColor=Color.Lerp(new Color(.025f,.17f,.21f),new Color(.22f,.51f,.54f),light);
                colors[j*N+i]=Color.Lerp(waterColor,new Color(.86f,.93f,.93f),sea.Foam(p,clock,s.crest));
            }
            mesh.vertices=vertices;mesh.colors32=colors;mesh.RecalculateBounds();
        }
    }
}
