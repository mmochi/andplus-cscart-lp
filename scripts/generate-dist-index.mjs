/**
 * public/dist 配下の ZIP などから index.html のリンク一覧を再生成する。
 * 使い方: npm run dist:index（カレントは cscart ルート想定）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '../public/dist');
const OUT = path.join(DIST, 'index.html');

/** @param {string} s */
function escHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** @param {string} abs */
function walkFiles(abs) {
  /** @type {string[]} */
  const out = [];
  if (!fs.existsSync(abs)) {
    return out;
  }
  const st = fs.statSync(abs);
  if (!st.isDirectory()) {
    return out;
  }
  for (const name of fs.readdirSync(abs, { withFileTypes: true })) {
    if (name.name.startsWith('.')) {
      continue;
    }
    const p = path.join(abs, name.name);
    if (name.isDirectory()) {
      out.push(...walkFiles(p));
    } else if (name.isFile()) {
      out.push(p);
    }
  }
  return out;
}

/**
 * @param {string} absFile
 * @returns {{ rel: string, href: string, bucket: string, sub: string, base: string }}
 */
function classify(absFile) {
  const rel = path.relative(DIST, absFile).split(path.sep).join('/');
  const parts = rel.split('/');
  const bucket = parts.length >= 2 ? parts[0] : '_root';
  const sub = parts.length >= 3 ? parts.slice(1, -1).join('/') : '';
  const base = path.basename(rel);
  const href = parts.map((seg) => encodeURIComponent(seg)).join('/');
  return { rel, href, bucket, sub, base };
}

function main() {
  const all = walkFiles(DIST).filter((abs) => {
    const b = path.basename(abs);
    if (b === 'index.html') {
      return false;
    }
    return true;
  });

  /** @type {Map<string, Map<string, { href: string; label: string; mtime: number }[]>>} */
  const grouped = new Map();

  for (const abs of all) {
    const { rel, href, bucket, sub, base } = classify(abs);
    const st = fs.statSync(abs);
    const mtime = st.mtimeMs;
    if (!grouped.has(bucket)) {
      grouped.set(bucket, new Map());
    }
    const subKey = sub || '(root)';
    const m = grouped.get(bucket);
    if (!m.has(subKey)) {
      m.set(subKey, []);
    }
    m.get(subKey).push({
      href,
      // サブフォルダ見出しがあるときはファイル名のみ（h3 と重複させない）
      label: sub !== '' ? base : rel,
      mtime,
    });
  }

  for (const m of grouped.values()) {
    for (const arr of m.values()) {
      // 新しいファイル（更新日時が新しい）を先頭
      arr.sort((a, b) => b.mtime - a.mtime || b.label.localeCompare(a.label, 'ja'));
    }
  }

  const bucketOrder = (a, b) => {
    const order = ['upstream', 'jp'];
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia !== -1 || ib !== -1) {
      if (ia === -1) {
        return 1;
      }
      if (ib === -1) {
        return -1;
      }
      return ia - ib;
    }
    return a.localeCompare(b, 'ja');
  };

  const bucketTitle = (bucket) => {
    if (bucket === 'upstream') {
      return 'upstream（本家 CS-Cart 向け）';
    }
    if (bucket === 'jp') {
      return 'jp（日本語版パッケージ）';
    }
    if (bucket === '_root') {
      return '直下（dist ルート）';
    }
    return bucket;
  };

  const buckets = [...grouped.keys()].sort(bucketOrder);

  let body = '';
  for (const bucket of buckets) {
    const m = grouped.get(bucket);
    if (!m) {
      continue;
    }
    body += `  <h2>${escHtml(bucketTitle(bucket))}</h2>\n`;
    // バージョンフォルダ名は新しい方が先（4.20.1 が 4.19.1 より上）。直下のみは末尾。
    const subs = [...m.keys()].sort((a, b) => {
      if (a === '(root)') {
        return 1;
      }
      if (b === '(root)') {
        return -1;
      }
      return b.localeCompare(a, 'ja', { numeric: true });
    });
    for (const sub of subs) {
      const items = m.get(sub);
      if (!items || items.length === 0) {
        continue;
      }
      if (sub !== '(root)') {
        body += `  <h3><code>${escHtml(sub)}</code></h3>\n`;
      }
      body += '  <ul>\n';
      for (const it of items) {
        body += `    <li><a href="${escHtml(it.href)}">${escHtml(it.label)}</a></li>\n`;
      }
      body += '  </ul>\n';
    }
  }

  if (body.trim() === '') {
    body = '  <p class="muted">配布物がまだありません（<code>public/dist/</code> 以下に ZIP を置いてから <code>npm run dist:index</code> を実行）。</p>\n';
  }

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>AP SafeCache — ZIP downloads</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; color: #222; }
    h1 { font-size: 1.35rem; margin-bottom: 0.5rem; }
    h2 { font-size: 1.05rem; margin-top: 1.75rem; border-bottom: 1px solid #ddd; padding-bottom: 0.25rem; }
    h3 { font-size: 0.95rem; margin-top: 1rem; margin-bottom: 0.35rem; font-weight: 600; }
    a { color: #0a5f9a; }
    .muted { color: #666; font-size: 0.9rem; }
    ul { padding-left: 1.25rem; }
    code { font-size: 0.9em; background: #f4f4f4; padding: 0.1em 0.35em; border-radius: 3px; }
  </style>
</head>
<body>
  <p class="muted"><a href="../">← AP SafeCache LP</a></p>
  <h1>AP SafeCache — ZIP downloads</h1>
  <p class="muted">配布 ZIP の置き場（<code>public/dist/</code>）。本家版 <code>upstream</code> と日本語版パッケージ <code>jp</code> を分けています。</p>
  <p class="muted" lang="en">Static download index. Links are generated by <code>npm run dist:index</code> from files under this directory.</p>

${body}</body>
</html>
`;

  fs.writeFileSync(OUT, html, 'utf8');
  // eslint-disable-next-line no-console
  console.log(`[generate-dist-index] wrote ${path.relative(process.cwd(), OUT)} (${all.length} files)`);
}

main();
