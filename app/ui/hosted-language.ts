/** Grammars included by shiki-small.ts. Other files remain fully visible as text. */
const languages = new Set([
  "text",
  "ansi",
  "javascript",
  "js",
  "typescript",
  "ts",
  "jsx",
  "tsx",
  "json",
  "css",
  "html",
  "python",
  "py",
  "shellscript",
  "shell",
  "sh",
  "bash",
  "yaml",
  "yml",
  "diff",
  "markdown",
  "md",
]);

export function hostedLanguage<T extends string>(language: T): T | "text" {
  return languages.has(language) ? language : "text";
}
