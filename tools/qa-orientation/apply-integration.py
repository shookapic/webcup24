"""Applies B's orientation integration to a scratch copy of A's committed source (never to a live tree).
python tools/qa-orientation/apply-integration.py <scratchDir> <B worktree dir>
The caller makes the unified diff (diff -u original scratch) for coordination/reports/B-orientation-integration.patch."""
import shutil
import sys

scratch, b = sys.argv[1], sys.argv[2]


def edit(path, pairs):
    s = open(f'{scratch}/{path}', encoding='utf-8').read()
    for old, new in pairs:
        assert old in s, (path, old[:60])
        s = s.replace(old, new, 1)
    open(f'{scratch}/{path}', 'w', encoding='utf-8').write(s)


shutil.copy(f'{b}/orientation.mjs', f'{scratch}/orientation.mjs')
shutil.copy(f'{b}/public/orientation.js', f'{scratch}/public/orientation.js')
shutil.copy(f'{b}/public/orientation.css', f'{scratch}/public/orientation.css')

NL = '\n'
edit('server.mjs', [
    ("import { groupSimilar } from './similar.mjs';", "import { groupSimilar } from './similar.mjs';" + NL + "import { handleOrientation } from './orientation.mjs';"),
    ("  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],",
     "  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']]," + NL + "  ['/orientation.js', ['orientation.js', 'text/javascript; charset=utf-8']]," + NL + "  ['/orientation.css', ['orientation.css', 'text/css; charset=utf-8']],"),
    ("  if (method === 'GET' && (path === '/monde' || path.startsWith('/monde/'))) return serveWorld(request, path, response);",
     "  // D10, F89-F92: public read-only index for the orientation helper (matching runs in the browser; nothing about the resident's request reaches the server)" + NL
     + "  if (await handleOrientation({ request, response, path, method, db, sendJson, fail, cityNow })) return;" + NL + NL
     + "  if (method === 'GET' && (path === '/monde' || path.startsWith('/monde/'))) return serveWorld(request, path, response);"),
])
edit('public/index.html', [
    ('    <link rel="stylesheet" href="/styles.css">', '    <link rel="stylesheet" href="/styles.css">' + NL + '    <link rel="stylesheet" href="/orientation.css">'),
    ('    <script src="/app.js" defer></script>', '    <script src="/orientation.js" defer></script>' + NL + '    <script src="/app.js" defer></script>'),
    ('      <section class="overview" id="services" aria-labelledby="services-title">',
     '      <section class="overview orientation-section" id="orientation" aria-labelledby="to-title" tabindex="-1">' + NL + '        <div id="orientation-root" data-content></div>' + NL + '      </section>' + NL + NL + '      <section class="overview" id="services" aria-labelledby="services-title">'),
])
mount = NL.join([
    "// D10, F89-F92: orientation helper (orientation.js), mounted once and updated when the user or the language changes.",
    "let orientationHandle = null;",
    "function mountOrientation() {",
    "  const root = document.getElementById('orientation-root');",
    "  if (!root || !window.TerraOrientation) return;",
    "  if (orientationHandle) orientationHandle.update({ user, lang });",
    "  else orientationHandle = window.TerraOrientation.mount(root, { user, lang, api });",
    "}",
    "",
    "async function afterAuthentication(nextUser) {",
    "  formTokens.clear();",
    "  user = nextUser;",
    "  mountOrientation();",
])
edit('public/app.js', [
    ("async function afterAuthentication(nextUser) {" + NL + "  formTokens.clear();" + NL + "  user = nextUser;", mount),
    ("function clearIdentity() {" + NL + "  user = null;", "function clearIdentity() {" + NL + "  user = null;" + NL + "  mountOrientation();"),
    ("  $('#lang-status').hidden = true;" + NL + "  applyLanguage();" + NL + "  renderIdentity();", "  $('#lang-status').hidden = true;" + NL + "  applyLanguage();" + NL + "  mountOrientation();" + NL + "  renderIdentity();"),
])
print('applied')
