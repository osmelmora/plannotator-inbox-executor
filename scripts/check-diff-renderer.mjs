import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "../app/node_modules/esbuild/lib/main.js";

const shikiModulePattern = /^shiki$/;
const shikiWasmPattern = /^shiki\/wasm$/;
const anyModulePattern = /.*/;

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = path.join(base, "app");
const outfile = path.join(base, ".runtime/ui-diff-renderer.mjs");
fs.mkdirSync(path.dirname(outfile), { recursive: true });
await build({
  absWorkingDir: app,
  entryPoints: [path.join(base, "tests/ui-diff-renderer.fixture.ts")],
  nodePaths: [path.join(app, "node_modules")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "warning",
  plugins: [
    {
      name: "deployed-highlighter",
      setup(builder) {
        builder.onResolve({ filter: shikiModulePattern }, () => ({
          path: path.join(app, "ui/shiki-small.ts"),
        }));
        builder.onResolve({ filter: shikiWasmPattern }, () => ({
          path: "disabled-wasm",
          namespace: "native-wasm",
        }));
        builder.onLoad(
          { filter: anyModulePattern, namespace: "native-wasm" },
          () => ({
            contents:
              'throw new Error("Only JavaScript highlighting is supported.");',
            loader: "js",
          })
        );
      },
    },
  ],
});
await import(pathToFileURL(outfile).href);
