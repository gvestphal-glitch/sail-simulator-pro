import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const mime = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  jpg: "image/jpeg",
  png: "image/png"
};
const entries = await readdir("dist", { withFileTypes: true });
const assets = Object.fromEntries(await Promise.all(entries.filter(file => file.isFile()).map(async ({name})=>{
  const type = mime[name.split(".").pop()];
  if (!type) throw new Error("Unsupported public asset " + name);
  const bytes = await readFile("dist/" + name);
  const etag = '"' + createHash("sha256").update(bytes).digest("hex").slice(0, 20) + '"';
  return ["/" + name, [type, etag, bytes.toString("base64")]];
})));
await mkdir("dist/server", { recursive: true });
const server = await readFile("../Backend/worker.mjs", "utf8");
await writeFile("dist/server/index.js", `const assets = ${JSON.stringify(assets)};\n${server}`);
