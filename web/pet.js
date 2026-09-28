(() => {
  const overlay = document.querySelector('#pet-overlay');
  const button = document.querySelector('#pet-button');
  const sprite = document.querySelector('#pet-sprite');
  const speech = document.querySelector('#pet-speech');
  const feedButton = document.querySelector('#pet-feed');
  const caption = document.querySelector('#pet-caption');
  const frames = {
    rest: ['/assets/pet-rest.png', 'A pixel-art Rottweiler relaxing with a bone'],
    sit: ['/assets/pet-sit.png', 'A pixel-art Rottweiler sitting'],
    happy: ['/assets/pet-happy.png', 'A happy pixel-art Rottweiler sitting with its tongue out'],
    curious: ['/assets/pet-curious.png', 'A pixel-art Rottweiler tilting its head'],
    wave: ['/assets/pet-wave.png', 'A pixel-art Rottweiler lifting one paw to wave'],
    fetch: ['/assets/pet-fetch.png', 'A pixel-art Rottweiler jumping to catch a bone'],
    sleep: ['/assets/pet-sleep.png', 'A pixel-art Rottweiler sleeping peacefully'],
    chew: ['/assets/pet-chew.png', 'A pixel-art Rottweiler chewing a treat'],
  };
  const hungryActions = [
    ['sit', 'Have you got a treat?'],
    ['curious', 'I’m waiting…'],
    ['wave', 'Could I have a snack?'],
    ['rest', 'I can wait right here.'],
  ];
  const fedActions = [
    ['rest', 'All good. I’ll hang out here.'],
    ['happy', 'That was lovely.'],
    ['curious', 'What are you working on?'],
    ['wave', 'Hey, you’re still there.'],
    ['sleep', 'Just having a little nap.'],
    ['sit', 'Keeping an eye on the shelf.'],
  ];
  let fed = false;
  let busy = false;
  let activeFrame = 'rest';
  let actionTimer;
  let speechTimer;

  function say(message, duration = 2600) {
    clearTimeout(speechTimer);
    speech.textContent = message;
    speech.hidden = !message;
    if (message) {
      speechTimer = setTimeout(() => {
        if (!busy) speech.hidden = true;
      }, duration);
    }
  }

  function pose(name, message) {
    const frame = frames[name];
    if (!frame) return;
    activeFrame = name;
    sprite.src = frame[0];
    sprite.alt = frame[1];
    button.classList.toggle('is-chewing', name === 'chew');
    if (message) say(message);
  }

  function scheduleAction(delay) {
    clearTimeout(actionTimer);
    actionTimer = setTimeout(() => {
      if (busy) return;
      const actions = fed ? fedActions : hungryActions;
      const options = actions.filter(([name]) => name !== activeFrame);
      const next = options[Math.floor(Math.random() * options.length)] || actions[0];
      pose(next[0], next[1]);
      scheduleAction(4200 + Math.random() * 2800);
    }, delay);
  }

  function feed() {
    if (busy) return;
    busy = true;
    clearTimeout(actionTimer);
    feedButton.disabled = true;
    feedButton.textContent = 'Offering a treat…';
    button.classList.add('is-feeding');
    say('Catch!', 5000);
    pose('fetch');
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
      scheduleAction(3600);
    }, 3800);
  }

  button.addEventListener('click', () => {
    if (busy) return;
    pose(fed ? 'happy' : 'wave', fed ? 'Hi again.' : 'I’m right here.');
    scheduleAction(4200 + Math.random() * 800);
  });
  feedButton.addEventListener('click', feed);
  scheduleAction(4300);
})();
