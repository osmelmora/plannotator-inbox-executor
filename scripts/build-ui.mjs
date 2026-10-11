/** Bundle retained UI locally, then let Executor host every emitted asset. */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../app/node_modules/esbuild/lib/main.js";

const transportModulePattern = /executor-transport\.js$/;
const anyModulePattern = /.*/;
const shikiModulePattern = /^shiki$/;
const shikiWasmPattern = /^shiki\/wasm$/;
const licenseFilePattern = /^(?:licen[sc]e(?:[._-].*)?|copying|ofl\.txt)$/i;

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = path.join(base, "app");
const outdir = path.join(app, "ui/public");
const result = await build({
  absWorkingDir: app,
  entryPoints: { "inbox-bundle": "ui/main.tsx" },
  bundle: true,
  write: false,
  minify: true,
  sourcemap: false,
  platform: "browser",
  format: "esm",
  splitting: true,
  outdir,
  jsx: "automatic",
  metafile: true,
  logLevel: "warning",
  legalComments: "eof",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "hosted-ui-boundaries",
      setup(builder) {
        builder.onResolve({ filter: transportModulePattern }, () => ({
          path: "executor-transport",
          namespace: "native-transport",
        }));
        builder.onLoad(
          { filter: anyModulePattern, namespace: "native-transport" },
          () => ({
            contents:
              "export const executorInboxRequest = (...args) => window.executorNativeInboxRequest(...args);",
            loader: "js",
          })
        );
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
              'throw new Error("Plannotator Inbox for Executor uses JavaScript syntax highlighting.");',
            loader: "js",
          })
        );
      },
    },
  ],
});
for (const meta of Object.values(result.metafile.outputs)) {
  if (meta.imports.some((i) => i.external)) {
    throw new Error("The hosted UI must have no external imports.");
  }
}
const receiptPath = path.join(base, "docs/ui-static-build-receipt.json");
const previous = fs.existsSync(receiptPath)
  ? JSON.parse(fs.readFileSync(receiptPath, "utf8"))
  : { assets: [] };
fs.mkdirSync(outdir, { recursive: true });
// Delete only assets the previous invocation of this script recorded.
for (const asset of previous.assets) {
  if (!/^[\w.-]+\.js$/.test(asset.path)) {
    throw new Error("Invalid previous asset path.");
  }
  const file = path.join(outdir, asset.path);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
}
const assets = [];
for (const output of result.outputFiles) {
  fs.writeFileSync(output.path, output.contents);
  assets.push({
    path: path.basename(output.path),
    bytes: output.contents.length,
    sha256: crypto.createHash("sha256").update(output.contents).digest("hex"),
  });
}
const packages = new Map();
// The generated styles.ts already contains these packages' CSS/font bytes, so
// they do not appear as direct JavaScript graph inputs.
const packageInputs = [
  ...Object.keys(result.metafile.inputs),
  "node_modules/@fontsource-variable/inter/package.json",
  "node_modules/@fontsource-variable/geist-mono/package.json",
  "node_modules/tailwindcss/package.json",
  "node_modules/tailwindcss-animate/package.json",
];
for (const input of packageInputs) {
  if (!input.startsWith("node_modules/")) {
    continue;
  }
  let current = path.dirname(path.resolve(app, input));
  while (current.startsWith(path.join(app, "node_modules"))) {
    const packageFile = path.join(current, "package.json");
    if (fs.existsSync(packageFile)) {
      const pkg = JSON.parse(fs.readFileSync(packageFile, "utf8"));
      if (typeof pkg.name !== "string" || typeof pkg.version !== "string") {
        current = path.dirname(current);
        continue;
      }
      const key = `${pkg.name}@${pkg.version}`;
      if (!packages.has(key)) {
        const licenseFiles = fs
          .readdirSync(current)
          .filter(
            (name) =>
              licenseFilePattern.test(name) &&
              fs.statSync(path.join(current, name)).isFile()
          );
        const texts = licenseFiles.map((name) => ({
          name,
          text: fs.readFileSync(path.join(current, name), "utf8"),
        }));
        // lru_map ships its complete MIT grant in README rather than LICENSE.
        if (!texts.length && pkg.name === "lru_map") {
          const readme = fs.readFileSync(
            path.join(current, "README.md"),
            "utf8"
          );
          const start = readme.indexOf("# MIT license");
          if (start < 0) {
            throw new Error("Missing lru_map license section.");
          }
          texts.push({
            name: "README.md (MIT license section)",
            text: readme.slice(start),
          });
        }
        packages.set(key, {
          name: pkg.name,
          version: pkg.version,
          license: pkg.license ?? null,
          texts,
        });
      }
      break;
    }
    current = path.dirname(current);
  }
}
const thirdParty = [...packages.values()].sort((a, b) =>
  a.name.localeCompare(b.name)
);
fs.writeFileSync(
  path.join(outdir, "THIRD-PARTY-LICENSES.txt"),
  thirdParty
    .map(
      (pkg) =>
        `${pkg.name}@${pkg.version}\nDeclared license: ${JSON.stringify(pkg.license)}\n${pkg.texts.map((t) => `\n${t.name}\n${t.text}`).join("\n")}`
    )
    .join("\n\n========================================\n\n")
);
fs.writeFileSync(
  path.join(base, "docs/ui-dependency-inventory.json"),
  `${JSON.stringify(
    thirdParty.map(({ texts, ...pkg }) => ({
      ...pkg,
      licenseFiles: texts.map((t) => t.name),
    })),
    null,
    2
  )}\n`
);
const receipt = {
  checkedAt: new Date().toISOString(),
  upstreamCommit: "177c34099258fa380c6b90c6f3e9411c13f6f463",
  localBuild: true,
  runtimeHosting: "Executor ui/public assets",
  assets,
  totalBytes: assets.reduce((n, a) => n + a.bytes, 0),
  sourceInputs: Object.keys(result.metafile.inputs).length,
  dependencies: thirdParty.length,
};
fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(
  JSON.stringify({
    assets: assets.length,
    bytes: receipt.totalBytes,
    inputs: receipt.sourceInputs,
  })
);
