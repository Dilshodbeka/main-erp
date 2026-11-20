const ts = require('/home/claude/main-erp/node_modules/typescript');
const fs = require('fs'), path = require('path');
const root = '/home/claude/main-erp/src';
const files = [];
(function walk(dir) { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.(tsx?|ts)$/.test(f) && !/\.test\./.test(f) && !/generated/.test(f)) files.push(p); } })(root);
const stats = { jsxText: 0, attr: 0, literal: 0, template: 0 };
const uniq = new Map();
const hasLetters = s => /[A-Za-zА-Яа-яЎўҚқҒғҲҳ‘’]{2,}/.test(s);
const looksUi = s => hasLetters(s) && /[ ‘’]|[A-ZА-Я]/.test(s) && !/^[a-z0-9_.:\/#-]+$/.test(s) && !/^(https?:|\.\/|\.\.\/|@)/.test(s);
for (const file of files) {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const add = (kind, text) => { const t = text.replace(/\s+/g, ' ').trim(); if (!t || !looksUi(t)) return; stats[kind]++; const e = uniq.get(t) || { n: 0, kinds: new Set(), files: new Set() }; e.n++; e.kinds.add(kind); e.files.add(path.relative(root, file)); uniq.set(t, e); };
  (function visit(node) {
    if (ts.isJsxText(node)) add('jsxText', node.text);
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const p = node.parent;
      if (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) return;
      if (ts.isJsxAttribute(p)) { if (/^(className|type|name|key|id|role|autoComplete|href|src|value|htmlFor|rel|target|inputMode|method)$/.test(p.name.getText())) return; add('attr', node.text); }
      else add('literal', node.text);
    } else if (ts.isTemplateExpression(node)) {
      const text = node.head.text + node.templateSpans.map((s, i) => `{${i}}` + s.literal.text).join('');
      add('template', text);
    }
    ts.forEachChild(node, visit);
  })(sf);
}
console.log(stats, 'unique:', uniq.size, 'files:', files.length);
const byKind = {}; for (const [t, e] of uniq) for (const k of e.kinds) byKind[k] = (byKind[k] || 0) + 1; console.log('unique by kind', byKind);
fs.writeFileSync(process.argv[2], JSON.stringify([...uniq].map(([t, e]) => ({ t, n: e.n, kinds: [...e.kinds], files: [...e.files].slice(0, 2) })), null, 0));
const chars = [...uniq.keys()].reduce((s, t) => s + t.length, 0); console.log('total chars', chars);
