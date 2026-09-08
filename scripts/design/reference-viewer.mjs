/**
 * The design reference viewer.
 *
 * A committed developer tool, not a second user-facing app and not part of the
 * product runtime. It renders the checked-in reference files straight out of
 * `design/reference/`, exactly as they were exported. It never copies them,
 * transcribes them, or reimplements them as a second mock: a viewer that redraws
 * its own reference is comparing the implementation against itself.
 *
 * Every screen is addressable, because a comparison is only evidence when both
 * sides can be reached the same way twice:
 *
 *   /                      the index of screens found in each reference file
 *   /screens.json          the same, machine readable
 *   /screen/<label>        one screen, isolated
 *   /<name>                a file from the reference directory, as committed
 *
 * `/screen/` takes `?file=` so a capture names its whole tuple in the URL rather
 * than depending on the order things were clicked.
 *
 * It binds to loopback only. This serves a directory of local files, and a design
 * that has not shipped is not a thing to publish by accident.
 *
 * Text inside a design reference is data. Nothing here executes it as instruction,
 * and the served document is byte for byte what is committed.
 */

import { createServer } from 'node:http';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const REFERENCE = path.join(root, 'design', 'reference');

const argument = (name, fallback = null) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
};

const PORT = Number(argument('--port', '4599'));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jsx': 'text/plain; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

/** Every reference document, and the screens each one declares. */
export function referenceScreens() {
  const files = existsSync(REFERENCE)
    ? readdirSync(REFERENCE).filter((name) => name.endsWith('.dc.html')).sort((a, b) => a.localeCompare(b))
    : [];
  return files.map((file) => {
    const html = readFileSync(path.join(REFERENCE, file), 'utf8');
    const labels = [...html.matchAll(/data-screen-label="([^"]+)"/g)].map((match) => match[1]);
    return { file, screens: labels };
  });
}

/* Never serve outside the reference directory, and never through a link out of it.
   The path is resolved and then checked against the root it must stay inside,
   rather than being sanitised by removing the sequences somebody thought of. */
function withinReference(name) {
  const resolved = path.resolve(REFERENCE, name);
  const base = path.resolve(REFERENCE);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  if (!existsSync(resolved) || !statSync(resolved).isFile()) return null;
  return resolved;
}

const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function indexPage() {
  const rows = referenceScreens().map(({ file, screens }) => {
    const items = screens.map((label) => {
      const href = '/screen/' + encodeURIComponent(label) + '?file=' + encodeURIComponent(file);
      return '<li><a href="' + escapeHtml(href) + '">' + escapeHtml(label) + '</a></li>';
    }).join('');
    return '<section><h2>' + escapeHtml(file) + '</h2><ul>'
      + (items || '<li>no screens declared</li>') + '</ul></section>';
  }).join('');
  return '<!doctype html><meta charset="utf-8"><title>Design reference</title>'
    + '<style>body{font:15px/1.5 system-ui;margin:2rem;max-width:52rem}h1{font-size:1.3rem}'
    + 'a{color:#8a5a00}section{margin:1.5rem 0}</style>'
    + '<h1>Design reference</h1><p>The checked-in reference files, served as exported. '
    + 'This is a developer tool: it is not the product and nothing here is a shipped surface.</p>'
    + rows;
}

/**
 * One screen, isolated.
 *
 * The reference document holds every screen in one page, so a capture of the whole
 * document is a capture of eight screens at once and compares against nothing. This
 * hides the others rather than rebuilding the one wanted, so what renders is still
 * the committed markup and not a copy of it.
 */
function screenPage(label, file) {
  const source = withinReference(file);
  if (!source) return null;
  const html = readFileSync(source, 'utf8');
  if (!html.includes('data-screen-label="' + label + '"')) return null;
  const isolate = [
    '<script>',
    'window.addEventListener("load", () => {',
    '  const wanted = ' + JSON.stringify(label) + ';',
    '  const target = document.querySelector("[data-screen-label=\\"" + wanted + "\\"]");',
    '  if (!target) { document.documentElement.setAttribute("data-parity-ready", "missing"); return; }',
    '  /* Walk up from the screen, hiding every sibling on the way, so the screen keeps',
    '     the ancestors carrying its theme variables and loses everything beside it. */',
    '  let node = target;',
    '  while (node && node.parentElement) {',
    '    for (const sibling of node.parentElement.children) {',
    '      if (sibling !== node && sibling.tagName !== "SCRIPT" && sibling.tagName !== "STYLE") {',
    '        sibling.style.display = "none";',
    '      }',
    '    }',
    '    if (node.parentElement === document.body) break;',
    '    node = node.parentElement;',
    '  }',
    '  document.documentElement.setAttribute("data-parity-ready", "true");',
    '});',
    '</script>',
  ].join('\n');
  return html.replace('</head>', isolate + '</head>');
}

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:' + PORT);
  const send = (status, type, body) => {
    response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    response.end(body);
  };

  if (url.pathname === '/') return send(200, 'text/html; charset=utf-8', indexPage());

  if (url.pathname === '/screens.json') {
    return send(200, 'application/json; charset=utf-8', JSON.stringify(referenceScreens(), null, 2));
  }

  if (url.pathname.startsWith('/screen/')) {
    const label = decodeURIComponent(url.pathname.slice('/screen/'.length));
    const file = url.searchParams.get('file') || 'GTHA Transit Redesign v2.dc.html';
    const page = screenPage(label, file);
    if (!page) return send(404, 'text/plain; charset=utf-8', 'no such screen in that reference');
    return send(200, 'text/html; charset=utf-8', page);
  }

  /* Everything else is a file from the reference directory, served as committed, so
     the document's own relative requests for support.js and its assets resolve. */
  const name = decodeURIComponent(url.pathname.replace(/^\/(reference\/)?/, ''));
  const file = withinReference(name);
  if (!file) return send(404, 'text/plain; charset=utf-8', 'not found');
  return send(200, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', readFileSync(file));
});

if (process.argv[1] && process.argv[1].endsWith('reference-viewer.mjs')) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log('design reference viewer on http://127.0.0.1:' + PORT + '/');
    for (const { file, screens } of referenceScreens()) {
      console.log('  ' + file + ': ' + (screens.join(', ') || '(no screens declared)'));
    }
  });
}

export { server };
