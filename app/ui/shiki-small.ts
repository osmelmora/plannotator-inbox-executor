/** Fine-grained Shiki bundle for the hosted vertical slice; unknown grammars render as text. */
import {
  createBundledHighlighter,
  createSingletonShorthands,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { bundledThemes } from "shiki/themes";

// biome-ignore lint/performance/noBarrelFile: This build alias preserves Shiki core exports while narrowing the bundled grammars.
export * from "shiki/core";
export { createJavaScriptRegexEngine } from "shiki/engine/javascript";
export { createOnigurumaEngine } from "shiki/engine/oniguruma";

const javascript = () => import("shiki/langs/javascript.mjs");
const typescript = () => import("shiki/langs/typescript.mjs");
const shell = () => import("shiki/langs/shellscript.mjs");
const python = () => import("shiki/langs/python.mjs");
export const bundledLanguages = {
  javascript,
  js: javascript,
  typescript,
  ts: typescript,
  jsx: () => import("shiki/langs/jsx.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  python,
  py: python,
  shellscript: shell,
  shell,
  sh: shell,
  bash: shell,
  yaml: () => import("shiki/langs/yaml.mjs"),
  yml: () => import("shiki/langs/yaml.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  md: () => import("shiki/langs/markdown.mjs"),
};
export const createHighlighter = createBundledHighlighter({
  langs: bundledLanguages,
  themes: bundledThemes,
  engine: () => createJavaScriptRegexEngine(),
});
export const { codeToHtml } = createSingletonShorthands(createHighlighter);
