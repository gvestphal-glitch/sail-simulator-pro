import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const build=path.join(root,'Builds/Web');
await fs.access(path.join(build,'index.html'));
const out=path.join(root,'Builds','Hosted');
await fs.mkdir(out,{recursive:true});
for(const item of await fs.readdir(path.join(root,'LegacyWeb/dist'),{withFileTypes:true})){
 if(item.isFile())await fs.copyFile(path.join(root,'LegacyWeb/dist',item.name),path.join(out,item.name));
}
await fs.cp(build,path.join(out,'unity'),{recursive:true});
console.log(out);
