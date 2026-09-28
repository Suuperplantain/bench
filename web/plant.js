(() => {
  const room = document.querySelector('.room');
  const mover = document.querySelector('#plant-mover');
  const plant = document.querySelector('#shelf-plant');
  const controls = document.querySelector('#plant-move-controls');
  if (!room || !mover || !plant || !controls) return;

  const storageKey = 'bench-shelf-plant-position';
  const step = 28;
  let savedPosition = null;
  let dragStart = null;
  let dragged = false;

  function bounds() {
    return {
      maxLeft: Math.max(0, room.clientWidth - mover.offsetWidth),
      maxTop: Math.max(0, room.clientHeight - mover.offsetHeight),
    };
  }

  function currentPosition() {
    const roomRect = room.getBoundingClientRect();
    const moverRect = mover.getBoundingClientRect();
    return { left: moverRect.left - roomRect.left, top: moverRect.top - roomRect.top };
  }

  function place(left, top, persist = true) {
    const limits = bounds();
    const nextLeft = Math.max(0, Math.min(limits.maxLeft, left));
    const nextTop = Math.max(0, Math.min(limits.maxTop, top));
    mover.style.left = nextLeft + 'px';
    mover.style.top = nextTop + 'px';
    if (persist) savePosition(nextLeft, nextTop);
  }

  function savePosition(left, top) {
    const limits = bounds();
    savedPosition = {
      x: limits.maxLeft ? left / limits.maxLeft : 0,
      y: limits.maxTop ? top / limits.maxTop : 0,
    };
    try { localStorage.setItem(storageKey, JSON.stringify(savedPosition)); }
    catch { /* The plant remains movable if browser storage is disabled. */ }
  }

  function applySavedPosition(position) {
    const limits = bounds();
    place(position.x * limits.maxLeft, position.y * limits.maxTop, false);
  }

  function setSelected(selected) {
    mover.classList.toggle('is-selected', selected);
    plant.setAttribute('aria-expanded', String(selected));
    controls.hidden = !selected;
  }

  const directions = {
    north: [0, -step],
    east: [step, 0],
    south: [0, step],
    west: [-step, 0],
  };

  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) {
      savedPosition = { x: Math.max(0, Math.min(1, stored.x)), y: Math.max(0, Math.min(1, stored.y)) };
      applySavedPosition(savedPosition);
    }
  } catch { /* Start at the CSS default when saved data is unavailable. */ }

  plant.addEventListener('click', () => {
    if (dragged) {
      dragged = false;
      return;
    }
    setSelected(controls.hidden);
  });

  controls.addEventListener('click', event => {
    const button = event.target.closest('button[data-direction]');
    if (!button) return;
    const movement = directions[button.dataset.direction];
    if (!movement) return;
    const position = currentPosition();
    place(position.left + movement[0], position.top + movement[1]);
    plant.focus({ preventScroll: true });
  });

  plant.addEventListener('pointerdown', event => {
    if (controls.hidden || event.button !== 0) return;
    event.preventDefault();
    const position = currentPosition();
    dragStart = { pointerX: event.clientX, pointerY: event.clientY, left: position.left, top: position.top };
    dragged = false;
    mover.classList.add('is-dragging');
    plant.setPointerCapture(event.pointerId);
  });

  plant.addEventListener('pointermove', event => {
    if (!dragStart) return;
    const dx = event.clientX - dragStart.pointerX;
    const dy = event.clientY - dragStart.pointerY;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragged = true;
    place(dragStart.left + dx, dragStart.top + dy);
  });

  function finishDrag(event) {
    if (!dragStart) return;
    dragStart = null;
    mover.classList.remove('is-dragging');
    if (plant.hasPointerCapture(event.pointerId)) plant.releasePointerCapture(event.pointerId);
  }

  plant.addEventListener('pointerup', finishDrag);
  plant.addEventListener('pointercancel', finishDrag);
  plant.addEventListener('dragstart', event => event.preventDefault());

  plant.addEventListener('dblclick', event => {
    event.preventDefault();
    savedPosition = null;
    mover.style.removeProperty('left');
    mover.style.removeProperty('top');
    try { localStorage.removeItem(storageKey); }
    catch { /* CSS defaults still apply. */ }
  });

  plant.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !controls.hidden) {
      setSelected(false);
      return;
    }
    if (controls.hidden) return;
    const movement = {
      ArrowUp: directions.north,
      ArrowRight: directions.east,
      ArrowDown: directions.south,
      ArrowLeft: directions.west,
    }[event.key];
    if (!movement) return;
    event.preventDefault();
    const position = currentPosition();
    place(position.left + movement[0], position.top + movement[1]);
  });

  window.addEventListener('resize', () => {
    if (savedPosition) applySavedPosition(savedPosition);
  });
})();
