(() => {
  const overlay = document.querySelector('#pet-overlay');
  const button = document.querySelector('#pet-button');
  const sprite = document.querySelector('#pet-sprite');
  const speech = document.querySelector('#pet-speech');
  const feedButton = document.querySelector('#pet-feed');
  const caption = document.querySelector('#pet-caption');
  const frames = {
    sit: ['/assets/pet-sit.png', 'A pixel-art Rottweiler sitting'],
    happy: ['/assets/pet-happy.png', 'A pixel-art Rottweiler sitting with its tongue out'],
    wave: ['/assets/pet-wave.png', 'A pixel-art Rottweiler raising one paw toward a project scroll'],
    fetch: ['/assets/pet-fetch.png', 'A pixel-art Rottweiler catching a treat'],
    sleep: ['/assets/pet-sleep.png', 'A pixel-art Rottweiler sleeping peacefully'],
    chew: ['/assets/pet-chew.png', 'A pixel-art Rottweiler chewing a treat'],
  };
  let tongueOut = false;
  let fed = false;
  let busy = false;
  let sleeping = false;
  let hoveringScroll = false;
  let speechTimer;
  let sleepTimer;

  function say(message, duration = 2400) {
    clearTimeout(speechTimer);
    speech.textContent = message;
    speech.hidden = !message;
    if (message) {
      speechTimer = setTimeout(() => { speech.hidden = true; }, duration);
    }
  }

  function pose(name, message = '') {
    const frame = frames[name];
    if (!frame) return;
    sprite.src = frame[0];
    sprite.alt = frame[1];
    button.classList.toggle('is-chewing', name === 'chew');
    if (message) say(message);
  }

  function sittingPose() {
    pose(tongueOut ? 'happy' : 'sit');
  }

  function startInactivityTimer() {
    clearTimeout(sleepTimer);
    sleepTimer = setTimeout(() => {
      sleeping = true;
      pose('sleep');
      say('Zzz…', 4000);
    }, 10 * 60 * 1000);
  }

  function noteActivity() {
    startInactivityTimer();
    if (sleeping) {
      sleeping = false;
      if (!busy) pose(hoveringScroll ? 'wave' : (tongueOut ? 'happy' : 'sit'));
    }
  }

  function cyclePose() {
    if (busy || sleeping || hoveringScroll) return;
    tongueOut = !tongueOut;
    sittingPose();
  }

  function feed() {
    if (busy) return;
    noteActivity();
    busy = true;
    feedButton.disabled = true;
    feedButton.textContent = 'Offering a treat…';
    button.classList.add('is-feeding');
    pose('fetch', 'Catch!');
    setTimeout(() => pose('chew', 'Mmm. Crunchy.'), 850);
    setTimeout(() => {
      fed = true;
      overlay.classList.remove('pet-hungry');
      overlay.classList.add('pet-fed');
      caption.textContent = 'HAPPY · BENCH’S BUDDY';
      pose('happy', 'Thanks for the treat.');
    }, 2650);
    setTimeout(() => {
      busy = false;
      button.classList.remove('is-feeding', 'is-chewing');
      feedButton.disabled = false;
      feedButton.innerHTML = '<span aria-hidden="true">✦</span> Give another treat';
      if (hoveringScroll) pose('wave');
      else sittingPose();
    }, 3800);
  }

  window.addEventListener('bench:project-scroll-hover', event => {
    hoveringScroll = event.detail === true;
    if (busy || sleeping) return;
    if (hoveringScroll) pose('wave');
    else sittingPose();
  });

  ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach(type => {
    document.addEventListener(type, noteActivity, { passive: true });
  });

  button.addEventListener('click', () => {
    if (!busy) say(fed ? 'Hey there.' : 'I’m right here.');
  });
  feedButton.addEventListener('click', feed);

  pose('sit');
  setInterval(cyclePose, 500);
  startInactivityTimer();
})();
