const rows = Array.from(document.querySelectorAll('.shelf-row'));
const countLabel = document.querySelector('#project-count');
const connectionLabel = document.querySelector('#connection-state');
const emptyNote = document.querySelector('#empty-note');
const projectDialog = document.querySelector('#project-dialog');
const addDialog = document.querySelector('#add-dialog');
const searchInput = document.querySelector('#project-search');
const launcherCount = document.querySelector('#launcher-project-count');
const launcher = document.querySelector('#bench-launcher');
const room = document.querySelector('#bench-room');
let projects = [];
let selectedProject = null;
let chatBusy = false;
let projectQuery = '';
const chatHistories = (() => { try { return JSON.parse(localStorage.getItem('bench-chat-histories') || '{}'); } catch { return {}; } })();
const scrollAssets = {
  priority: ['/assets/scroll-priority.png', 'Priority'],
  'in-progress': ['/assets/scroll-in-progress.png', 'In progress'],
  done: ['/assets/scroll-done.png', 'Done'],
};
const projectStatuses = (() => {
  try { return JSON.parse(localStorage.getItem('bench-project-statuses') || '{}'); }
  catch { return {}; }
})();
const marks = { Python: 'Py', Java: 'J', 'C++': 'C+', Go: 'Go', JavaScript: 'JS', TypeScript: 'TS', Rust: 'Rs', Ruby: 'Rb' };
function languageMark(language) { return marks[language] || (language ? language.slice(0, 2) : '⌘'); }
async function request(url, options) {
  options = options || {};
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Request failed (' + response.status + ')');
  return result;
}

function renderProjects() {
  rows.forEach(row => row.querySelector('.shelf-scrolls').replaceChildren());
  countLabel.textContent = projects.length + ' ' + (projects.length === 1 ? 'project' : 'projects') + ' on the shelf';
  launcherCount.textContent = String(projects.length);
  emptyNote.hidden = projects.length !== 0;
  const totals = { priority: 0, 'in-progress': 0, done: 0 };
  projects.forEach(project => {
    const status = projectStatuses[project.id] || project.status || 'in-progress';
    totals[status] += 1;
    if (projectQuery && !project.name.toLocaleLowerCase().includes(projectQuery)) return;
    const [scrollImage, statusLabel] = scrollAssets[status] || scrollAssets['in-progress'];
    const scroll = document.createElement('article');
    scroll.className = 'project-scroll project-scroll-' + status;
    const openScroll = document.createElement('button');
    openScroll.type = 'button';
    openScroll.className = 'scroll-open';
    openScroll.title = statusLabel + ' · ' + project.name;
    openScroll.setAttribute('aria-label', project.name + ', ' + statusLabel + ', ' + (project.language || 'language not detected') + ', ' + (project.dirty ? 'uncommitted changes' : 'clean working tree') + '. Open project details.');
    const image = document.createElement('img');
    image.src = scrollImage;
    image.alt = '';
    image.draggable = false;
    const label = document.createElement('span');
    label.className = 'scroll-label';
    const copy = document.createElement('span');
    copy.className = 'scroll-copy';
    const name = document.createElement('span');
    name.className = 'scroll-name';
    name.textContent = project.name;
    const state = document.createElement('span');
    state.className = 'scroll-state';
    state.textContent = statusLabel;
    const language = document.createElement('span');
    language.className = 'scroll-language';
    language.textContent = languageMark(project.language);
    copy.append(name, state);
    label.append(copy, language);
    openScroll.append(image, label);
    scroll.append(openScroll);
    const statusSelect = document.createElement('select');
    statusSelect.className = 'scroll-status-select';
    statusSelect.setAttribute('aria-label', 'Status for ' + project.name);
    [['priority','Priority'],['in-progress','In progress'],['done','Done']].forEach(([value, text]) => {
      const option = document.createElement('option'); option.value = value; option.textContent = text; option.selected = value === status; statusSelect.append(option);
    });
    statusSelect.addEventListener('click', event => event.stopPropagation());
    statusSelect.addEventListener('change', event => {
      event.stopPropagation(); projectStatuses[project.id] = statusSelect.value;
      try { localStorage.setItem('bench-project-statuses', JSON.stringify(projectStatuses)); } catch { /* Status stays visible until reload. */ }
      renderProjects();
    });
    scroll.append(statusSelect);
    openScroll.addEventListener('mouseenter', () => window.dispatchEvent(new CustomEvent('bench:project-scroll-hover', { detail: true })));
    openScroll.addEventListener('mouseleave', () => window.dispatchEvent(new CustomEvent('bench:project-scroll-hover', { detail: false })));
    openScroll.addEventListener('click', () => openProject(project));
    const shelf = rows.find(row => row.dataset.shelf === status) || rows[1];
    shelf.querySelector('.shelf-scrolls').append(scroll);
  });
  Object.entries(totals).forEach(([status, count]) => {
    const label = document.querySelector('[data-shelf-count="' + status + '"]');
    if (label) label.textContent = String(count);
  });
}

let narrowShelf = window.matchMedia('(max-width: 720px)').matches;
window.addEventListener('resize', () => {
  const isNarrow = window.matchMedia('(max-width: 720px)').matches;
  if (isNarrow !== narrowShelf) {
    narrowShelf = isNarrow;
    renderProjects();
  }
});

async function loadProjects() {
  countLabel.textContent = 'Loading saved projects…';
  connectionLabel.textContent = 'READING LOCAL PROJECT INDEX';
  try {
    const result = await request('/api/projects');
    projects = result.projects || [];
    window.dispatchEvent(new CustomEvent('bench:commit-total', {
      detail: projects.reduce((total, project) => total + (Number(project.commit_count) || 0), 0),
    }));
    renderProjects();
    connectionLabel.textContent = 'CONNECTED · LOCAL ONLY';
  } catch (error) {
    projects = [];
    renderProjects();
    countLabel.textContent = 'Bench API isn’t running';
    emptyNote.hidden = true;
    connectionLabel.textContent = 'START BENCH TO LOAD PROJECTS';
    console.error('Could not load Bench projects:', error);
  }
}

function openProject(project) {
  selectedProject = project;
  document.querySelector('#dialog-title').textContent = project.name;
  document.querySelector('#project-note').value = project.note || '';
  document.querySelector('#note-status').textContent = '＋';
  document.querySelector('#workbench-state').innerHTML = '<i></i> READY';
  selectWorkspaceTab('desk');
  renderChat(project);
  projectDialog.showModal();
}

const workspaceViews = new Set(['desk', 'changes', 'files']);

function selectWorkspaceTab(view) {
  if (!workspaceViews.has(view)) view = 'desk';
  document.querySelectorAll('[data-workspace-tab]').forEach(tab => {
    const active = tab.dataset.workspaceTab === view;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  document.querySelector('#workbench-page').setAttribute('aria-labelledby', 'tab-' + view);
}

document.querySelectorAll('[data-workspace-tab]').forEach(tab => {
  tab.addEventListener('click', () => selectWorkspaceTab(tab.dataset.workspaceTab));
});

function saveChatHistories() {
  try { localStorage.setItem('bench-chat-histories', JSON.stringify(chatHistories)); } catch { /* The active chat still works if storage is full or unavailable. */ }
}

function appendChatMessage(role, text, container = document.querySelector('#chat-messages')) {
  const bubble = document.createElement('div');
  bubble.className = 'chat-message ' + role;
  bubble.textContent = text;
  container.append(bubble);
  container.scrollTop = container.scrollHeight;
  return bubble;
}

function renderChat(project) {
  const messages = document.querySelector('#chat-messages');
  messages.replaceChildren();
  document.querySelector('#chat-status').textContent = 'Changes stay in this repository.';
  document.querySelector('#chat-scope').textContent = 'REPO SCOPED';
  const history = chatHistories[project.id] || [];
  if (!history.length) {
    const welcome = document.createElement('p');
    welcome.className = 'chat-welcome';
    const title = document.createElement('strong');
    title.textContent = 'Let’s work on ' + project.name;
    const description = document.createElement('span');
    description.textContent = 'Ask a question or describe a change. Codex will receive this repository as its working directory.';
    welcome.append(title, description);
    messages.append(welcome);
    return;
  }
  history.forEach(message => appendChatMessage(message.role, message.text, messages));
}

function saveChatMessage(projectID, role, text) {
  const history = chatHistories[projectID] || (chatHistories[projectID] = []);
  history.push({ role, text });
  if (history.length > 60) history.splice(0, history.length - 60);
  saveChatHistories();
}

function parseChatEvent(block) {
  let type = '';
  let data = '';
  block.split(/\r?\n/).forEach(line => {
    if (line.startsWith('event:')) type = line.slice(6).trim();
    if (line.startsWith('data:')) data += line.slice(5).trim();
  });
  if (!type || !data) return null;
  try { return { type, payload: JSON.parse(data) }; } catch { return null; }
}

document.querySelector('#chat-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!selectedProject) return;
  const project = selectedProject;
  const input = document.querySelector('#chat-input');
  const send = document.querySelector('#chat-send');
  const status = document.querySelector('#chat-status');
  const message = input.value.trim();
  if (!message) return;
  document.querySelector('.chat-welcome')?.remove();
  appendChatMessage('user', message);
  saveChatMessage(project.id, 'user', message);
  input.value = '';
  input.disabled = true;
  send.disabled = true;
  chatBusy = true;
  document.querySelector('.project-dialog .dialog-close').disabled = true;
  status.textContent = 'Codex is working…';
  document.querySelector('#workbench-state').innerHTML = '<i></i> WORKING';
  let assistantBubble = null;
  let assistantText = '';
  try {
    const response = await fetch('/api/projects/' + encodeURIComponent(project.id) + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || 'Chat request failed (' + response.status + ')');
    }
    if (!response.body) throw new Error('Streaming responses are not supported in this browser.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    let finished = false;
    while (!finished) {
      const { value, done } = await reader.read();
      buffered += decoder.decode(value || new Uint8Array(), { stream: !done });
      const blocks = buffered.split(/\r?\n\r?\n/);
      buffered = blocks.pop() || '';
      for (const block of blocks) {
        const item = parseChatEvent(block);
        if (!item) continue;
        if (item.type === 'thread') document.querySelector('#chat-scope').textContent = 'CONNECTED TO REPO';
        if (item.type === 'delta') {
          if (!assistantBubble) assistantBubble = appendChatMessage('assistant', '');
          assistantText += item.payload.text || '';
          assistantBubble.textContent = assistantText;
          document.querySelector('#chat-messages').scrollTop = document.querySelector('#chat-messages').scrollHeight;
        }
        if (item.type === 'done') {
          finished = true;
          if (assistantText) saveChatMessage(project.id, 'assistant', assistantText);
          status.textContent = 'Ready · working in ' + project.name;
          document.querySelector('#workbench-state').innerHTML = '<i></i> READY';
        }
        if (item.type === 'error') {
          const error = item.payload.text || 'Codex could not complete that request.';
          appendChatMessage('error', error);
          saveChatMessage(project.id, 'error', error);
          status.textContent = 'Chat needs attention';
          document.querySelector('#workbench-state').innerHTML = '<i></i> ATTENTION';
          finished = true;
        }
      }
      if (done) break;
    }
    if (!assistantText && status.textContent === 'Codex is working…') status.textContent = 'Ready';
  } catch (error) {
    const message = error.message || 'Codex could not complete that request.';
    appendChatMessage('error', message);
    saveChatMessage(project.id, 'error', message);
    status.textContent = 'Chat needs attention';
    document.querySelector('#workbench-state').innerHTML = '<i></i> ATTENTION';
  } finally {
    chatBusy = false;
    document.querySelector('.project-dialog .dialog-close').disabled = false;
    input.disabled = false;
    send.disabled = false;
    input.focus();
  }
});

projectDialog.addEventListener('cancel', event => {
  if (chatBusy) event.preventDefault();
});

document.querySelector('#save-note').addEventListener('click', async event => {
  if (!selectedProject) return;
  const button = event.currentTarget;
  const status = document.querySelector('#note-status');
  button.disabled = true;
  status.textContent = 'Saving…';
  try {
    const note = document.querySelector('#project-note').value;
    await request('/api/projects/' + encodeURIComponent(selectedProject.id) + '/note', { method: 'PUT', body: JSON.stringify({ note }) });
    selectedProject.note = note;
    status.textContent = '✓';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#add-project-button').addEventListener('click', () => {
  document.querySelector('#project-path').value = '';
  document.querySelector('#add-error').textContent = '';
  addDialog.showModal();
  document.querySelector('#project-path').focus();
});

async function addProject() {
  const pathInput = document.querySelector('#project-path');
  const errorLabel = document.querySelector('#add-error');
  const submit = document.querySelector('#submit-project');
  const path = pathInput.value.trim();
  if (!path) {
    errorLabel.textContent = 'Enter the folder path first.';
    pathInput.focus();
    return;
  }
  submit.disabled = true;
  errorLabel.textContent = 'Checking this repository…';
  try {
    await request('/api/projects', { method: 'POST', body: JSON.stringify({ path }) });
    addDialog.close();
    await loadProjects();
  } catch (error) {
    errorLabel.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
}

document.querySelector('#submit-project').addEventListener('click', addProject);
document.querySelector('#project-path').addEventListener('keydown', event => { if (event.key === 'Enter') addProject(); });
document.querySelector('#refresh-button').addEventListener('click', loadProjects);
searchInput.addEventListener('input', () => { projectQuery = searchInput.value.trim().toLocaleLowerCase(); renderProjects(); });

function setRoomExpanded(expanded) {
  room.classList.toggle('is-expanded', expanded);
  room.inert = !expanded;
  launcher.setAttribute('aria-expanded', String(expanded));
  launcher.title = expanded ? 'Close Bench' : 'Open Bench';
  if (window.benchWindow?.setExpanded) window.benchWindow.setExpanded(expanded).catch(() => {});
}
launcher.addEventListener('click', () => setRoomExpanded(!room.classList.contains('is-expanded')));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !projectDialog.open && !addDialog.open) setRoomExpanded(false);
});
loadProjects();
