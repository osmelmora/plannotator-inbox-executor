/** Compile the real UI; fail if a server-side source import entered its graph. */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../app/node_modules/esbuild/lib/main.js";

const nodeModulePattern = /^node:/;

const here = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../app/ui"
);
const root = path.dirname(here);
const result = await build({
  absWorkingDir: root,
  entryPoints: ["ui/host.ts"],
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  splitting: true,
  outdir: "ui/.unwritten-build",
  jsx: "automatic",
  metafile: true,
  logLevel: "warning",
});
const inputs = Object.keys(result.metafile.inputs);
if (
  inputs.some(
    (input) =>
      input.startsWith("lib/") ||
      input.startsWith("domain/") ||
      input === "index.ts"
  )
) {
  throw new Error("Server source entered the browser bundle.");
}
// Executor's dependency resolver can select a package's Node condition even
// while compiling its UI. Keep our optional browser renderers explicit.
const conditional = await build({
  absWorkingDir: root,
  entryPoints: ["ui/host.ts"],
  bundle: true,
  write: false,
  platform: "browser",
  conditions: ["node", "browser", "import"],
  // Executor injects its pinned browser framework modules separately.
  external: ["apps", "apps/client"],
  format: "esm",
  splitting: true,
  outdir: "ui/.unwritten-build",
  jsx: "automatic",
  metafile: true,
  logLevel: "warning",
  plugins: [
    {
      name: "reject-node-runtime",
      setup(builder) {
        builder.onResolve(
          { filter: nodeModulePattern },
          ({ path: importPath }) => ({
            errors: [{ text: `Node binding in UI: ${importPath}` }],
          })
        );
      },
    },
  ],
});
if (
  Object.keys(conditional.metafile.inputs).some((input) =>
    input.includes("uuid/dist-node/")
  )
) {
  throw new Error("Mermaid selected its Node UUID dependency.");
}
for (const metadata of Object.values(conditional.metafile.outputs)) {
  for (const dependency of metadata.imports) {
    if (
      dependency.external &&
      !["apps", "apps/client"].includes(dependency.path) &&
      !/^https?:\/\//.test(dependency.path)
    ) {
      throw new Error(
        `Executor rejects unresolved UI imports: ${dependency.path.slice(0, 120)}`
      );
    }
  }
}
const receipt = {
  upstreamCommit: "177c34099258fa380c6b90c6f3e9411c13f6f463",
  checkedAt: new Date().toISOString(),
  compiler: "esbuild browser ES modules, automatic JSX, no custom aliases",
  sourceInputs: inputs.length,
  outputFiles: result.outputFiles.length,
  outputBytes: result.outputFiles.reduce(
    (total, file) => total + file.contents.length,
    0
  ),
  serverModulesInBrowser: false,
  hostNodeConditionGuard: true,
  hostOutputImportGuard: true,
  realExecutorDeployment: false,
};
fs.writeFileSync(
  path.resolve(here, "../../docs/ui-build-receipt.json"),
  `${JSON.stringify(receipt, null, 2)}\n`
);
console.log(JSON.stringify(receipt));
