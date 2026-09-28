const rows = Array.from(document.querySelectorAll('.shelf-row'));
const countLabel = document.querySelector('#project-count');
const connectionLabel = document.querySelector('#connection-state');
const emptyNote = document.querySelector('#empty-note');
const projectDialog = document.querySelector('#project-dialog');
const addDialog = document.querySelector('#add-dialog');
let projects = [];
let selectedProject = null;
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
  projectDialog.showModal();
}

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
