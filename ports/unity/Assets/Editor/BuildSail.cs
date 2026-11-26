using System;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;
namespace Sailing.Editor {
    public static class BuildSail {
        [MenuItem("Sail/Build/Web")] public static void Web()=>Build(BuildTarget.WebGL,"Web");
        [MenuItem("Sail/Build/Windows")] public static void Windows()=>Build(BuildTarget.StandaloneWindows64,"Windows/SailSimulator.exe");
        [MenuItem("Sail/Build/Linux")] public static void Linux()=>Build(BuildTarget.StandaloneLinux64,"Linux/SailSimulator");
        [MenuItem("Sail/Build/macOS")] public static void Mac()=>Build(BuildTarget.StandaloneOSX,"macOS/SailSimulator.app");
        [MenuItem("Sail/Build/Android")] public static void Android()=>Build(BuildTarget.Android,"Android/SailSimulator.apk");
        [MenuItem("Sail/Build/iOS")] public static void IOS()=>Build(BuildTarget.iOS,"iOS");
        static void Build(BuildTarget target,string file){
            var group=BuildPipeline.GetBuildTargetGroup(target);
            if(!BuildPipeline.IsBuildTargetSupported(group,target))throw new InvalidOperationException("Instale o módulo "+target);
            if(target==BuildTarget.WebGL)PlayerSettings.WebGL.compressionFormat=WebGLCompressionFormat.Disabled;
            PlayerSettings.productName="Sail Simulator Pro";PlayerSettings.companyName="Sailing Solutions";
            PlayerSettings.SetApplicationIdentifier(UnityEditor.Build.NamedBuildTarget.FromBuildTargetGroup(group),"br.com.sailingsolutions.sailsimulatorpro");
            string output="Builds/"+file;System.IO.Directory.CreateDirectory(System.IO.Path.GetDirectoryName(output));
            var result=BuildPipeline.BuildPlayer(new BuildPlayerOptions{scenes=new[]{"Assets/Scenes/Regatta.unity"},target=target,locationPathName=output});
            if(result.summary.result!=BuildResult.Succeeded)throw new Exception("Build interrompido: "+result.summary.result);
            Debug.Log("Build concluído: "+output);
        }
    }
}
