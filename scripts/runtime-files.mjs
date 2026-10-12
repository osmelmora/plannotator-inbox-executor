/** Print the app files Executor needs from index.ts and ui/index.html: what
 * esbuild bundles plus what TypeScript loads, including type-only imports. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../app/node_modules/esbuild/lib/main.js";
import ts from "../app/node_modules/typescript/lib/typescript.js";

const commentPattern = /<!--[\s\S]*?-->/g;
const tagPattern = /<(script|link)\b([^>]*)>/gi;
const sourcePattern = /(?:^|\s)src\s*=\s*["']([^"':]+)["']/i;

const app = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../app"
);
const html = fs
  .readFileSync(path.join(app, "ui/index.html"), "utf8")
  .replace(commentPattern, "");
const entries = ["index.ts"];
for (const [tag, name, attributes] of html.matchAll(tagPattern)) {
  const source =
    name.toLowerCase() === "script" && attributes.match(sourcePattern)?.[1];
  if (!source || source.startsWith("/")) {
    throw new Error(`runtime-files.mjs cannot follow ${tag} in ui/index.html.`);
  }
  entries.push(path.posix.join("ui", source));
}
const bundled = await build({
  absWorkingDir: app,
  entryPoints: entries,
  bundle: true,
  write: false,
  platform: "neutral",
  format: "esm",
  packages: "external",
  metafile: true,
  outdir: "unused",
  logLevel: "error",
});
const typed = ts
  .createProgram(
    entries.map((entry) => path.join(app, entry)),
    {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      resolveJsonModule: true,
      allowImportingTsExtensions: true,
      noEmit: true,
      types: [],
    }
  )
  .getSourceFiles()
  .map((file) => path.relative(app, file.fileName))
  .filter(
    (file) =>
      !(file.startsWith("..") || file.split(path.sep).includes("node_modules"))
  );
console.log(
  JSON.stringify(
    [...new Set([...Object.keys(bundled.metafile.inputs), ...typed])].sort()
  )
);
