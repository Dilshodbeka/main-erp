// Собирает src/locales/ru.json из партий перевода (ru-N.tsv: номер<TAB>перевод, ключ — uz-keys.json[номер])
// и из ru-extra.tsv (узбекская строка<TAB>перевод — для строк, которых нет в пронумерованном списке).
// Проверяет, что плейсхолдеры {0}, {1}… в переводе те же, что в исходной строке.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const keys = JSON.parse(readFileSync(join(here, 'uz-keys.json'), 'utf8'));
const holders = text => [...text.matchAll(/\{(\d+)\}/g)].map(match => match[1]).sort().join(',');
const dictionary = {};
const problems = [];

const entities = { '&gt;': '>', '&lt;': '<', '&amp;': '&', '&quot;': '"', '&nbsp;': '\u00a0' };
const decode = text => text.replace(/&(gt|lt|amp|quot|nbsp);/g, match => entities[match]);

function add(rawSource, rawTarget, where) {
  const source = decode(rawSource), target = decode(rawTarget);
  if (!source || !target) return;
  if (holders(source) !== holders(target)) problems.push(`${where}: плейсхолдеры не совпадают — «${source}» → «${target}»`);
  if (dictionary[source] !== undefined && dictionary[source] !== target) problems.push(`${where}: повтор с другим переводом — «${source}»`);
  dictionary[source] = target;
}

for (const file of readdirSync(here).filter(name => /^ru-\d+\.tsv$/.test(name)).sort((a, b) => parseInt(a.slice(3)) - parseInt(b.slice(3)))) {
  readFileSync(join(here, file), 'utf8').split('\n').forEach((line, index) => {
    if (!line.trim()) return;
    const tab = line.indexOf('\t');
    const id = Number(line.slice(0, tab));
    if (tab < 0 || !Number.isInteger(id) || keys[id] === undefined) { problems.push(`${file}:${index + 1}: неверный номер`); return; }
    add(keys[id], line.slice(tab + 1).trim(), `${file}:${index + 1}`);
  });
}
try {
  readFileSync(join(here, 'ru-extra.tsv'), 'utf8').split('\n').forEach((line, index) => {
    if (!line.trim() || line.startsWith('#')) return;
    const tab = line.indexOf('\t');
    if (tab < 0) { problems.push(`ru-extra.tsv:${index + 1}: нет табуляции`); return; }
    add(line.slice(0, tab), line.slice(tab + 1).trim(), `ru-extra.tsv:${index + 1}`);
  });
} catch (error) { if (error.code !== 'ENOENT') throw error; }

if (problems.length) throw new Error(problems.join('\n'));
const sorted = Object.fromEntries(Object.entries(dictionary).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
if (process.argv[1] && process.argv[1].endsWith('build.mjs') && !process.argv.includes('--check')) {
  mkdirSync(join(here, '../../src/locales'), { recursive: true });
  writeFileSync(join(here, '../../src/locales/ru.json'), `${JSON.stringify(sorted, null, 0)}\n`);
}
if (process.argv[1] && process.argv[1].endsWith('build.mjs')) console.log(`ru.json: ${Object.keys(sorted).length} строк`);
export default sorted;
