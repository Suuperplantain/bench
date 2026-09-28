(() => {
  const overlay = document.querySelector('#pet-overlay');
  const button = document.querySelector('#pet-button');
  const sprite = document.querySelector('#pet-sprite');
  const speech = document.querySelector('#pet-speech');
  const feedButton = document.querySelector('#pet-feed');
  const caption = document.querySelector('#pet-caption');
  const treatCount = document.querySelector('#treat-count');
  const commitProgress = document.querySelector('#commit-progress');
  const sleepButton = document.querySelector('#pet-sleep-toggle');
  const hungerFill = document.querySelector('#pet-hunger-fill');
  const hungerMeter = document.querySelector('#pet-hunger');
  const hungerValue = document.querySelector('#pet-hunger-value');
  const healthFill = document.querySelector('#pet-health-fill');
  const healthMeter = document.querySelector('#pet-health');
  const healthValue = document.querySelector('#pet-health-value');
  const TREAT_EVERY = 7;
  const STATE_KEY = 'bench-pet-vitals-v1';
  const frames = {
    sit: ['/assets/pet-sit.png', 'A pixel-art Rottweiler sitting'],
    happy: ['/assets/pet-happy.png', 'A pixel-art Rottweiler sitting with its tongue out'],
    wave: ['/assets/pet-wave.png', 'A pixel-art Rottweiler raising one paw toward a project scroll'],
    sleep: ['/assets/pet-sleep.png', 'A pixel-art Rottweiler sleeping peacefully'],
    eat1: ['/assets/pet-eat-1.png', 'A pixel-art Rottweiler beginning to eat a bone'],
    eat2: ['/assets/pet-eat-2.png', 'A pixel-art Rottweiler chewing a bone'],
    eat3: ['/assets/pet-eat-3.png', 'A pixel-art Rottweiler taking a bite from a bone'],
    eat4: ['/assets/pet-eat-4.png', 'A pixel-art Rottweiler chewing with crumbs around its mouth'],
  };
  const saved = (() => {
    try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); }
    catch { return {}; }
  })();
  const state = {
    hunger: clamp(saved.hunger, 0, 100, 100),
    health: clamp(saved.health, 0, 100, 100),
    treatsUsed: Math.max(0, Number(saved.treatsUsed) || 0),
    lastUpdated: Number(saved.lastUpdated) || Date.now(),
    sleeping: saved.sleeping === true,
    manualSleep: saved.manualSleep === true,
  };
  let commitTotal = 0;
  let busy = false;
  let hoveringScroll = false;
  let speechTimer;
  let sleepTimer;

  function clamp(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
  }

  function availableTreats() {
    return Math.max(0, Math.floor(commitTotal / TREAT_EVERY) - state.treatsUsed);
  }

  function save() {
    state.lastUpdated = Date.now();
    try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch { /* Keep the pet usable when storage is unavailable. */ }
  }

  function say(message, duration = 2600) {
    clearTimeout(speechTimer);
    speech.textContent = message;
    speech.hidden = !message;
    if (message) speechTimer = setTimeout(() => { speech.hidden = true; }, duration);
  }

  function pose(name) {
    const frame = frames[name];
    if (!frame) return;
    sprite.src = frame[0];
    sprite.alt = frame[1];
    sprite.classList.toggle('has-white-matte', name.startsWith('eat'));
  }

  function render() {
    const hunger = Math.round(state.hunger);
    const health = Math.round(state.health);
    const treats = availableTreats();
    const commitsToNext = TREAT_EVERY - (commitTotal % TREAT_EVERY);
    treatCount.textContent = String(treats);
    commitProgress.textContent = treats > 0 ? `Next in ${commitsToNext} commits` : `${commitTotal % TREAT_EVERY} / ${TREAT_EVERY} commits`;
    feedButton.disabled = busy || treats === 0;
    feedButton.title = treats === 0 ? `${commitsToNext} more commit${commitsToNext === 1 ? '' : 's'} for a treat` : `${treats} treat${treats === 1 ? '' : 's'} ready`;
    feedButton.innerHTML = `<span aria-hidden="true">✦</span> ${treats ? 'Give a treat' : 'Earn a treat'}`;
    hungerFill.style.width = `${state.hunger}%`;
    healthFill.style.width = `${state.health}%`;
    hungerMeter.setAttribute('aria-valuenow', String(hunger));
    healthMeter.setAttribute('aria-valuenow', String(health));
    hungerMeter.classList.toggle('is-low', state.hunger < 25);
    healthMeter.classList.toggle('is-low', state.health < 25);
    hungerValue.textContent = `${hunger}%`;
    healthValue.textContent = `${health}%`;
    sleepButton.textContent = state.sleeping ? '☀ Wake him' : '☾ Tell him to sleep';
    sleepButton.setAttribute('aria-pressed', String(state.sleeping));
    overlay.classList.toggle('pet-sleeping', state.sleeping);
    overlay.classList.toggle('pet-hungry', hunger < 25);
    overlay.classList.toggle('pet-fed', hunger >= 25);
    if (!busy) caption.textContent = state.sleeping ? 'SLEEPING · BENCH’S BUDDY' : hunger < 25 ? 'HUNGRY · BENCH’S BUDDY' : 'CONTENT · BENCH’S BUDDY';
  }

  function applyElapsedTime(now = Date.now()) {
    const elapsed = Math.max(0, now - state.lastUpdated);
    state.hunger = Math.max(0, state.hunger - elapsed / (25 * 60 * 1000) * 100);
    const healthLifetime = state.sleeping ? 15 * 60 * 60 * 1000 : 5 * 60 * 60 * 1000;
    state.health = Math.max(0, state.health - elapsed / healthLifetime * 100);
    state.lastUpdated = now;
  }

  function wake() {
    applyElapsedTime();
    state.sleeping = false;
    state.manualSleep = false;
    save();
    if (!busy) pose(hoveringScroll ? 'wave' : 'sit');
    render();
    startInactivityTimer();
  }

  function sleep(manual = false) {
    applyElapsedTime();
    state.sleeping = true;
    state.manualSleep = manual;
    save();
    clearTimeout(sleepTimer);
    pose('sleep');
    render();
    if (manual) say('I’m off for a rest.');
  }

  function startInactivityTimer() {
    clearTimeout(sleepTimer);
    if (!state.sleeping) sleepTimer = setTimeout(() => sleep(false), 10 * 60 * 1000);
  }

  function noteActivity(event) {
    if (event && event.target instanceof Element && event.target.closest('#pet-sleep-toggle')) return;
    if (state.sleeping && state.manualSleep) {
      return;
    }
    if (state.sleeping) wake();
    else startInactivityTimer();
  }

  function feed() {
    if (busy) return;
    applyElapsedTime();
    if (state.sleeping) wake();
    if (!availableTreats()) {
      render();
      say(`${TREAT_EVERY - (commitTotal % TREAT_EVERY)} more commit${TREAT_EVERY - (commitTotal % TREAT_EVERY) === 1 ? '' : 's'} for a treat.`);
      return;
    }
    state.treatsUsed += 1;
    busy = true;
    save();
    render();
    button.classList.add('is-feeding');
    state.hunger = 100;
    state.health = Math.min(100, state.health + 8);
    const eatingSequence = ['eat1', 'eat2', 'eat3', 'eat4', 'eat3', 'eat2'];
    const frameDelay = 720;
    let index = 0;
    pose(eatingSequence[index]);
    say('Here comes your treat.', 5200);
    const eatingTimer = setInterval(() => {
      index += 1;
      if (index >= eatingSequence.length) {
        clearInterval(eatingTimer);
        busy = false;
        button.classList.remove('is-feeding');
        pose(state.sleeping ? 'sleep' : hoveringScroll ? 'wave' : 'sit');
        render();
        save();
        say('Good lad. Thanks for the treat.');
        return;
      }
      pose(eatingSequence[index]);
    }, frameDelay);
  }

  window.addEventListener('bench:project-scroll-hover', event => {
    hoveringScroll = event.detail === true;
    if (busy || state.sleeping) return;
    pose(hoveringScroll ? 'wave' : 'sit');
  });
  window.addEventListener('bench:commit-total', event => {
    commitTotal = Math.max(0, Number(event.detail) || 0);
    render();
  });

  ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach(type => {
    document.addEventListener(type, noteActivity, { passive: true });
  });
  button.addEventListener('click', () => { if (!busy) say(state.sleeping ? 'Shh… I’m dreaming.' : 'Hey there.'); });
  feedButton.addEventListener('click', feed);
  sleepButton.addEventListener('click', () => {
    if (state.sleeping) wake();
    else sleep(true);
  });

  applyElapsedTime();
  pose(state.sleeping ? 'sleep' : 'sit');
  render();
  save();
  setInterval(() => {
    applyElapsedTime();
    render();
    save();
  }, 60 * 1000);
  startInactivityTimer();
})();
