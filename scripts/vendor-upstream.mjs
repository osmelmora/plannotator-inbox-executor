/** Copy only the Inbox's transitive source dependencies; never mutate upstream. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../app/ui');
if (!process.argv[2]) throw new Error('Initial-import helper requires an explicit pinned upstream checkout path. Normal builds use the retained vendor source.');
const upstream = path.resolve(process.argv[2]);
const target = path.resolve(here, '../vendor');
if (fs.existsSync(path.join(target, 'UPSTREAM.json'))) throw new Error('Initial import only: refusing to overwrite the adapted fork. Use the checked-in vendor source for deployment.');
const require = createRequire(new URL('../app/package.json', import.meta.url));
const ts = require('typescript');
const visited = new Set();
const external = new Set();
const inventory = [];
const mime = { '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

function resolveFile(candidate) {
  for (const p of [candidate, candidate.replace(/\.js$/, '.ts'), candidate.replace(/\.js$/, '.tsx'), `${candidate}.ts`, `${candidate}.tsx`, `${candidate}.d.ts`, `${candidate}/index.ts`, `${candidate}/index.tsx`]) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  throw new Error(`Missing vendor import: ${candidate}`);
}
function locate(specifier, importer) {
  if (specifier === '#guide-reader') return resolveFile(path.join(upstream, 'packages/inbox/guide/GuideReader.tsx'));
  if (specifier.startsWith('@plannotator/')) {
    const [, name, rest = ''] = specifier.match(/^@plannotator\/([^/]+)\/?(.*)$/);
    const base = path.join(upstream, 'packages', name);
    if (!fs.existsSync(base)) return null;
    return resolveFile(path.join(base, rest || 'index'));
  }
  if (specifier.startsWith('.')) return resolveFile(path.resolve(path.dirname(importer), specifier));
  return null;
}
function destination(source) {
  const relative = path.relative(path.join(upstream, 'packages'), source);
  if (relative.startsWith('..')) throw new Error(`Import escapes packages: ${source}`);
  return path.join(target, relative);
}
function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
function copy(source) {
  if (visited.has(source)) return;
  visited.add(source);
  const original = fs.readFileSync(source);
  const dest = destination(source);
  inventory.push({ path: path.relative(target, dest), upstreamSha256: crypto.createHash('sha256').update(original).digest('hex') });
  if (mime[path.extname(source)]) {
    write(`${dest}.ts`, `// Upstream binary asset encoded for Executor's text-only app source.\nexport default ${JSON.stringify(`data:${mime[path.extname(source)]};base64,${original.toString('base64')}`)};\n`);
    return;
  }
  let text = original.toString('utf8');
  if (source.endsWith('/review-editor/workerPool.tsx')) {
    text = text.replace(/\/\/ Vite-inlined worker[\s\S]*?import DiffsWorker[^\n]+\n/, '');
    text = text.replace('new DiffsWorker() as Worker', '(() => { throw new Error("Executor uses the supported main-thread highlighter fallback."); })()');
  }
  const ast = ts.createSourceFile(source, text, ts.ScriptTarget.Latest, true, source.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const literals = [];
  function visit(n) {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) literals.push(n.moduleSpecifier);
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteral(n.arguments[0])) literals.push(n.arguments[0]);
    ts.forEachChild(n, visit);
  }
  visit(ast);
  const replacements = [];
  for (const literal of literals) {
    const specifier = literal.text;
    const found = locate(specifier, source);
    if (!found) { external.add(specifier); continue; }
    copy(found);
    let relative = path.relative(path.dirname(dest), destination(found));
    if (mime[path.extname(found)]) relative += '.js';
    else relative = relative.replace(/(?:\.d)?\.tsx?$/, '.js');
    if (!relative.startsWith('.')) relative = `./${relative}`;
    replacements.push([literal.getStart(ast), literal.end, JSON.stringify(relative)]);
  }
  for (const [start, end, replacement] of replacements.sort((a, b) => b[0] - a[0])) text = text.slice(0, start) + replacement + text.slice(end);
  write(dest, text);
}

copy(path.join(upstream, 'packages/inbox/index.ts'));
for (const name of fs.readdirSync(path.join(upstream, 'packages/core'))) {
  if (name.endsWith('.ts') && !name.endsWith('.test.ts')) copy(path.join(upstream, 'packages/core', name));
}
for (const name of ['theme.css', 'inbox.css', 'print.css', 'globals.d.ts']) {
  const packageName = name === 'inbox.css' ? 'inbox' : 'ui';
  fs.copyFileSync(path.join(upstream, 'packages', packageName, name), path.join(target, packageName, name));
}
fs.cpSync(path.join(upstream, 'packages/ui/themes'), path.join(target, 'ui/themes'), { recursive: true });
for (const license of ['LICENSE-MIT', 'LICENSE-APACHE']) fs.copyFileSync(path.join(upstream, license), path.join(target, license));
write(path.join(target, 'UPSTREAM.json'), JSON.stringify({ repository: 'https://github.com/backnotprop/plannotator', commit: '177c34099258fa380c6b90c6f3e9411c13f6f463', version: '0.28.11', license: 'Apache-2.0', files: inventory.sort((a, b) => a.path.localeCompare(b.path)) }, null, 2) + '\n');
write(path.resolve(here, '../../docs/ui-vendor-imports.json'), JSON.stringify([...external].sort(), null, 2) + '\n');
console.log(`Copied ${visited.size} files; ${external.size} external imports.`);
