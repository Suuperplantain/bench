const rows = Array.from(document.querySelectorAll('.shelf-row'));
const countLabel = document.querySelector('#project-count');
const connectionLabel = document.querySelector('#connection-state');
const emptyNote = document.querySelector('#empty-note');
const projectDialog = document.querySelector('#project-dialog');
const addDialog = document.querySelector('#add-dialog');
let projects = [];
let selectedProject = null;
let chatBusy = false;
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
function shortDate(value) { return value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : 'Not available'; }

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
  rows.forEach(row => row.replaceChildren());
  countLabel.textContent = projects.length + ' ' + (projects.length === 1 ? 'project' : 'projects') + ' on the shelf';
  emptyNote.hidden = projects.length !== 0;
  const perShelf = window.matchMedia('(max-width: 720px)').matches ? 2 : 3;
  projects.forEach((project, index) => {
    const status = projectStatuses[project.id] || 'in-progress';
    const [scrollImage, statusLabel] = scrollAssets[status] || scrollAssets['in-progress'];
    const scroll = document.createElement('button');
    scroll.type = 'button';
    scroll.className = 'project-scroll';
    scroll.title = statusLabel + ' · ' + project.name;
    scroll.setAttribute('aria-label', project.name + ', ' + statusLabel + ', ' + (project.language || 'language not detected') + ', ' + (project.dirty ? 'uncommitted changes' : 'clean working tree') + '. Open project details.');
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
    scroll.append(image, label);
    scroll.addEventListener('mouseenter', () => window.dispatchEvent(new CustomEvent('bench:project-scroll-hover', { detail: true })));
    scroll.addEventListener('mouseleave', () => window.dispatchEvent(new CustomEvent('bench:project-scroll-hover', { detail: false })));
    scroll.addEventListener('click', () => openProject(project));
    const shelfIndex = Math.max(0, rows.length - 1 - Math.floor(index / perShelf));
    rows[shelfIndex].append(scroll);
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
  document.querySelector('#dialog-path').textContent = project.path;
  const statusSelect = document.querySelector('#project-status');
  statusSelect.value = projectStatuses[project.id] || 'in-progress';
  statusSelect.onchange = () => {
    projectStatuses[project.id] = statusSelect.value;
    localStorage.setItem('bench-project-statuses', JSON.stringify(projectStatuses));
    renderProjects();
  };
  document.querySelector('#project-note').value = project.note || '';
  document.querySelector('#note-status').textContent = '';
  const grid = document.querySelector('#detail-grid');
  grid.replaceChildren();
  const details = [
    ['Language', project.language || 'Not detected'],
    ['Branch', project.branch || 'No branch'],
    ['Working tree', project.dirty ? 'Changes not committed' : 'Clean'],
    ['Last commit', shortDate(project.last_commit_at)],
    ['Latest commit', project.latest_commit || 'Not available'],
  ];
  details.forEach(([label, value]) => {
    const cell = document.createElement('div');
    cell.className = 'detail-cell';
    const heading = document.createElement('span');
    heading.textContent = label;
    const detail = document.createElement('strong');
    detail.textContent = value;
    cell.append(heading, detail);
    grid.append(cell);
  });
  renderChat(project);
  projectDialog.showModal();
}

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
        }
        if (item.type === 'error') {
          const error = item.payload.text || 'Codex could not complete that request.';
          appendChatMessage('error', error);
          saveChatMessage(project.id, 'error', error);
          status.textContent = 'Chat needs attention';
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
    status.textContent = 'Saved locally';
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
loadProjects();
