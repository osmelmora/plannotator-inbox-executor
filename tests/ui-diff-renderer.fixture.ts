import assert from "node:assert/strict";
import {
  DiffHunksRenderer,
  getFiletypeFromFileName,
  getSingularPatch,
  // biome-ignore lint/correctness/noUndeclaredDependencies: The renderer check bundles this fixture with app/node_modules resolution.
} from "@pierre/diffs";
import { hostedLanguage } from "../app/ui/hosted-language.js";

// Exercise the real renderer with the same reduced Shiki module used in deployment.
for (const [filename, expected] of [
  ["sample.ts", "typescript"],
  ["sample.rs", "text"],
  ["sample.go", "text"],
] as const) {
  const diff = getSingularPatch(
    `diff --git a/${filename} b/${filename}\n--- a/${filename}\n+++ b/${filename}\n@@ -1 +1 @@\n-const enabled = false;\n+const enabled = true;\n`
  );
  diff.lang = hostedLanguage(diff.lang ?? getFiletypeFromFileName(diff.name));
  assert.equal(diff.lang, expected);
  const renderer = new DiffHunksRenderer({
    theme: "github-light",
    diffStyle: "split",
  });
  const rendered = await renderer.asyncRender(diff);
  assert.ok(rendered.additionsContentAST?.length);
  assert.ok(rendered.deletionsContentAST?.length);
  const textNodes = (node: unknown): string => {
    if (Array.isArray(node)) {
      return node.map(textNodes).join("");
    }
    if (node && typeof node === "object") {
      const value = node as {
        type?: string;
        value?: string;
        children?: unknown[];
      };
      return value.type === "text"
        ? (value.value ?? "")
        : textNodes(value.children);
    }
    return "";
  };
  assert.ok(
    textNodes(rendered.additionsContentAST).includes("const enabled = true;")
  );
  assert.ok(
    textNodes(rendered.deletionsContentAST).includes("const enabled = false;")
  );
  renderer.cleanUp();
}
console.log(
  "3 real Pierre renderer cases passed: TypeScript highlighted, Rust/Go plaintext."
);
