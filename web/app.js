const rows = Array.from(document.querySelectorAll('.shelf-row'));
const countLabel = document.querySelector('#project-count');
const connectionLabel = document.querySelector('#connection-state');
const emptyNote = document.querySelector('#empty-note');
const projectDialog = document.querySelector('#project-dialog');
const addDialog = document.querySelector('#add-dialog');
let projects = [];
let selectedProject = null;

const colorSet = ['#c8854f', '#b86b48', '#c59a58', '#87945c', '#8d7460', '#b7785a', '#78908a', '#c49a73'];
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
  const perShelf = Math.max(1, Math.ceil(projects.length / rows.length));
  projects.forEach((project, index) => {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'project-tile';
    tile.style.setProperty('--accent', colorSet[index % colorSet.length]);
    tile.setAttribute('aria-label', project.name + ', ' + (project.language || 'language not detected') + ', ' + (project.dirty ? 'uncommitted changes' : 'clean working tree') + '. Open project details.');
    const icon = document.createElement('span');
    icon.className = 'tile-icon';
    icon.textContent = languageMark(project.language);
    icon.setAttribute('aria-hidden', 'true');
    const copy = document.createElement('span');
    copy.className = 'tile-copy';
    const name = document.createElement('span');
    name.className = 'tile-name';
    name.textContent = project.name;
    const language = document.createElement('span');
    language.className = 'tile-language';
    language.textContent = project.language || project.branch || 'Git project';
    copy.append(name, language);
    const status = document.createElement('span');
    status.className = 'tile-status' + (project.dirty ? ' dirty' : '');
    status.title = project.dirty ? 'Uncommitted changes' : 'Working tree is clean';
    tile.append(icon, copy, status);
    tile.addEventListener('click', () => openProject(project));
    rows[Math.floor(index / perShelf)].append(tile);
  });
}

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

// The companion stays independent from project tiles so its behaviors can grow separately.
const petFrames = [
  { src: '/assets/pet-rest.png', alt: 'A pixel-art Rottweiler relaxing with a bone', line: 'Glad you’re here.' },
  { src: '/assets/pet-wave.png', alt: 'A pixel-art Rottweiler lifting one paw to wave', line: 'Hey! Want to look around?' },
  { src: '/assets/pet-happy.png', alt: 'A happy pixel-art Rottweiler sitting with its tongue out', line: 'I’m keeping this shelf safe.' },
  { src: '/assets/pet-curious.png', alt: 'A pixel-art Rottweiler tilting its head', line: 'What are we building today?' },
  { src: '/assets/pet-chew.png', alt: 'A pixel-art Rottweiler chewing a treat', line: 'Just having a little snack.' },
  { src: '/assets/pet-fetch.png', alt: 'A pixel-art Rottweiler jumping up to catch a bone', line: 'Did somebody say fetch?' },
  { src: '/assets/pet-sleep.png', alt: 'A pixel-art Rottweiler sleeping peacefully', line: 'I’ll keep an eye on things.' },
];
let petFrame = 0;
const petSprite = document.querySelector('#pet-sprite');
const petSpeech = document.querySelector('#pet-speech');
let speechTimer;
document.querySelector('#pet-button').addEventListener('click', () => {
  petFrame = (petFrame + 1) % petFrames.length;
  const next = petFrames[petFrame];
  petSprite.src = next.src;
  petSprite.alt = next.alt;
  petSpeech.textContent = next.line;
  petSpeech.hidden = false;
  clearTimeout(speechTimer);
  speechTimer = setTimeout(() => {
    petSpeech.hidden = true;
    petFrame = 0;
    petSprite.src = petFrames[0].src;
    petSprite.alt = petFrames[0].alt;
  }, 3600);
});
