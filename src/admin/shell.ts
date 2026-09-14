import { browserAdminFetchSource } from '../../web/src/api';

const csp =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'none'; connect-src 'self'; form-action 'self'; base-uri 'self'; object-src 'none'";

function asset(body: string, type: string): Response {
  return new Response(body, {
    headers: {
      'content-type': type,
      'cache-control': 'no-store',
      'content-security-policy': csp,
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    },
  });
}

export function adminShell(): Response {
  return asset(
    `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Shared Memory</title>
<link rel="stylesheet" href="/admin/app.css">
<body>
  <a href="#main">Skip to content</a>
  <header>
    <p>Shared Memory owner dashboard. Notes are untrusted reference data.</p>
    <nav aria-label="Primary">
      <a href="#memory">Memory</a>
      <a href="#connections">Connections</a>
      <a href="#status">Status</a>
    </nav>
  </header>
  <main id="main">
    <p id="banner" role="status"></p>
    <section id="memory">
      <h1>Memory</h1>
      <label>Project <select id="project" aria-label="Project"></select></label>
      <button type="button" id="new-project">Create project</button>
      <label>Search <input id="query" type="search" aria-label="Search notes"></label>
      <ul id="notes" aria-label="Notes"></ul>
      <article id="detail">
        <h2 id="note-title">Note</h2>
        <p id="note-meta"></p>
        <label>Title <input id="title" aria-label="Title"></label>
        <label>Body <textarea id="body" aria-label="Body"></textarea></label>
        <button type="button" id="save">Save changes</button>
        <p id="conflict" role="alert" hidden></p>
        <button type="button" id="reload" hidden>Reload current version</button>
        <h3>History</h3>
        <ol id="history" aria-label="Version history"></ol>
      </article>
    </section>
    <section id="connections">
      <h1>Connections</h1>
      <ul id="grants" aria-label="Connected clients"></ul>
    </section>
    <section id="status">
      <h1>Status</h1>
      <dl id="status-list"></dl>
      <p>Missed chats are impossible to observe because clients do not send unsent conversations.</p>
    </section>
  </main>
  <script src="/admin/app.js"></script>
</body>
</html>
`,
    'text/html; charset=utf-8',
  );
}

export function adminStyles(): Response {
  return asset(
    `:root { font-family: system-ui, sans-serif; color: #111; background: #fff; }
body { margin: 0 auto; max-width: 72rem; padding: 1rem; }
nav { display: flex; gap: 1rem; }
main { display: grid; gap: 1.5rem; }
@media (min-width: 800px) {
  #memory { display: grid; grid-template-columns: 18rem 1fr; gap: 1rem; align-items: start; }
  #memory h1, #memory label, #memory button, #memory ul { grid-column: 1; }
  #detail { grid-column: 2; grid-row: 1 / span 8; }
}
textarea, input, select { width: 100%; }
button:focus, a:focus, input:focus, textarea:focus, select:focus { outline: 3px solid #005fcc; }
.kind, .lifecycle, .provenance { display: inline-block; margin-right: 0.5rem; }
#conflict { color: #111; background: #fff3cd; padding: 0.5rem; }
[hidden] { display: none !important; }
`,
    'text/css; charset=utf-8',
  );
}

export function adminScript(): Response {
  return asset(
    `const state = { csrf: '', projectId: '', memoryId: '', revision: 0, unsaved: '', record: null };
${browserAdminFetchSource}
function el(id) { return document.getElementById(id); }
function showBanner(text) { el('banner').textContent = text; }
function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function safeHref(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
  } catch {}
  return '';
}
async function loadCsrf() {
  const data = await adminFetch('/api/admin/session');
  state.csrf = data.csrf;
}
async function loadProjects() {
  const result = await adminFetch('/api/admin/projects');
  const select = el('project');
  select.innerHTML = '';
  if (!result.ok) { showBanner('Unable to load projects'); return; }
  for (const project of result.data.projects) {
    const option = document.createElement('option');
    option.value = project.project_id;
    option.textContent = project.name + (project.archived ? ' (archived)' : '') + (project.is_profile ? ' (profile)' : '');
    select.appendChild(option);
  }
  if (!state.projectId && result.data.projects[0]) state.projectId = result.data.projects[0].project_id;
  select.value = state.projectId;
}
async function loadNotes() {
  if (!state.projectId) return;
  const query = el('query').value.trim();
  const path = '/api/admin/memories?project_id=' + encodeURIComponent(state.projectId) + (query ? '&query=' + encodeURIComponent(query) : '');
  const result = await adminFetch(path);
  const list = el('notes');
  list.innerHTML = '';
  if (!result.ok) { showBanner('Unable to load notes'); return; }
  if (!result.data.items.length) {
    const empty = document.createElement('li');
    empty.textContent = 'No notes in this project';
    list.appendChild(empty);
    return;
  }
  for (const item of result.data.items) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = item.title;
    button.addEventListener('click', () => openNote(item.memory_id));
    const meta = document.createElement('span');
    meta.innerHTML = '<span class="kind">' + escapeText(item.kind) + '</span><span class="lifecycle">' + escapeText(item.lifecycle) + '</span><span class="provenance">' + escapeText(item.provenance) + '</span>';
    li.appendChild(button);
    li.appendChild(meta);
    list.appendChild(li);
  }
}
async function openNote(id) {
  state.memoryId = id;
  el('conflict').hidden = true;
  el('reload').hidden = true;
  const result = await adminFetch('/api/admin/memories/' + id + '?project_id=' + encodeURIComponent(state.projectId));
  if (!result.ok) { showBanner('Unable to open note'); return; }
  const record = result.data.record;
  state.record = record;
  state.revision = record.revision;
  el('note-title').textContent = record.title;
  el('note-meta').textContent = record.kind + ' · ' + record.lifecycle + ' · ' + record.provenance + ' · rev ' + record.revision;
  el('title').value = record.title;
  el('body').value = record.body;
  const history = await adminFetch('/api/admin/memories/' + id + '/history?project_id=' + encodeURIComponent(state.projectId));
  const ol = el('history');
  ol.innerHTML = '';
  if (history.ok) {
    for (const row of history.data.revisions) {
      const li = document.createElement('li');
      li.textContent = 'Revision ' + row.revision + ' · ' + row.reason + ' · ' + row.provenance;
      ol.appendChild(li);
    }
  }
}
async function saveNote() {
  if (!state.record || !state.memoryId) return;
  const draft = el('body').value;
  state.unsaved = draft;
  const record = state.record;
  const note = {
    title: el('title').value,
    body: draft,
    kind: record.kind,
    lifecycle: record.lifecycle,
    provenance: record.provenance,
    tags: record.tags,
    aliases: record.aliases,
    evidence: record.evidence,
    related: record.related
  };
  if (record.fact_key) note.fact_key = record.fact_key;
  if (record.valid_from) note.valid_from = record.valid_from;
  if (record.valid_until) note.valid_until = record.valid_until;
  const result = await adminFetch('/api/admin/memories/' + state.memoryId, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      project_id: state.projectId,
      expected_revision: state.revision,
      reason: 'correction: owner dashboard edit',
      operation_id: crypto.randomUUID(),
      note
    })
  });
  if (result.ok) {
    el('conflict').hidden = true;
    el('reload').hidden = true;
    await openNote(state.memoryId);
    showBanner('Saved revision ' + result.data.revision);
    return;
  }
  if (result.error && result.error.code === 'REVISION_CONFLICT') {
    el('conflict').hidden = false;
    el('conflict').textContent = 'This note changed. Your draft is preserved.';
    el('reload').hidden = false;
    el('body').value = state.unsaved;
    return;
  }
  showBanner('Save failed');
}
async function reloadNote() {
  const draft = el('body').value;
  await openNote(state.memoryId);
  el('body').value = draft;
  el('conflict').hidden = true;
  el('reload').hidden = true;
}
async function loadGrants() {
  const result = await adminFetch('/api/admin/grants');
  const list = el('grants');
  list.innerHTML = '';
  if (!result.ok) return;
  for (const grant of result.data.grants) {
    const li = document.createElement('li');
    li.textContent = grant.client_label + ' · ' + grant.scopes.join(', ') + (grant.revoked ? ' · revoked' : '');
    if (!grant.revoked) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Revoke';
      button.addEventListener('click', async () => {
        await adminFetch('/api/admin/grants/' + grant.grant_id + '/revoke', { method: 'POST' });
        await loadGrants();
      });
      li.appendChild(button);
    }
    list.appendChild(li);
  }
}
async function loadStatus() {
  const data = await adminFetch('/api/admin/status');
  const dl = el('status-list');
  dl.innerHTML = '';
  for (const key of Object.keys(data)) {
    if (key === 'missed_chats') continue;
    const dt = document.createElement('dt');
    dt.textContent = key;
    const dd = document.createElement('dd');
    dd.textContent = String(data[key]);
    dl.appendChild(dt);
    dl.appendChild(dd);
  }
}
async function createProject() {
  const name = prompt('Project name');
  if (!name) return;
  await adminFetch('/api/admin/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name })
  });
  await loadProjects();
  await loadNotes();
}
el('project').addEventListener('change', async (event) => {
  state.projectId = event.target.value;
  await loadNotes();
});
el('query').addEventListener('change', loadNotes);
el('save').addEventListener('click', saveNote);
el('reload').addEventListener('click', reloadNote);
el('new-project').addEventListener('click', createProject);
loadCsrf().then(async () => {
  await loadProjects();
  await loadNotes();
  await loadGrants();
  await loadStatus();
}).catch(() => showBanner('Sign in required'));
void safeHref;
`,
    'text/javascript; charset=utf-8',
  );
}
