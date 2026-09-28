(() => {
  const room = document.querySelector('.room');
  const plant = document.querySelector('#shelf-plant');
  if (!room || !plant) return;

  const storageKey = 'bench-shelf-plant-position';
  let savedPosition = null;
  let dragStart = null;

  function bounds() {
    return {
      maxLeft: Math.max(0, room.clientWidth - plant.offsetWidth),
      maxTop: Math.max(0, room.clientHeight - plant.offsetHeight),
    };
  }

  function applyPosition(x, y) {
    const limits = bounds();
    const left = Math.max(0, Math.min(limits.maxLeft, x * limits.maxLeft));
    const top = Math.max(0, Math.min(limits.maxTop, y * limits.maxTop));
    plant.style.left = left + 'px';
    plant.style.top = top + 'px';
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

  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) {
      savedPosition = { x: Math.max(0, Math.min(1, stored.x)), y: Math.max(0, Math.min(1, stored.y)) };
      applyPosition(savedPosition.x, savedPosition.y);
    }
  } catch { /* Start at the CSS default when saved data is unavailable. */ }

  plant.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    const rect = plant.getBoundingClientRect();
    dragStart = { pointerX: event.clientX, pointerY: event.clientY, left: rect.left, top: rect.top };
    plant.classList.add('is-dragging');
    plant.setPointerCapture(event.pointerId);
  });

  plant.addEventListener('pointermove', event => {
    if (!dragStart) return;
    const roomRect = room.getBoundingClientRect();
    const limits = bounds();
    const left = Math.max(0, Math.min(limits.maxLeft, dragStart.left + event.clientX - dragStart.pointerX - roomRect.left));
    const top = Math.max(0, Math.min(limits.maxTop, dragStart.top + event.clientY - dragStart.pointerY - roomRect.top));
    plant.style.left = left + 'px';
    plant.style.top = top + 'px';
  });

  function finishDrag(event) {
    if (!dragStart) return;
    const roomRect = room.getBoundingClientRect();
    const rect = plant.getBoundingClientRect();
    savePosition(rect.left - roomRect.left, rect.top - roomRect.top);
    dragStart = null;
    plant.classList.remove('is-dragging');
    if (plant.hasPointerCapture(event.pointerId)) plant.releasePointerCapture(event.pointerId);
  }

  plant.addEventListener('pointerup', finishDrag);
  plant.addEventListener('pointercancel', finishDrag);
  plant.addEventListener('dragstart', event => event.preventDefault());

  plant.addEventListener('dblclick', () => {
    savedPosition = null;
    plant.style.removeProperty('left');
    plant.style.removeProperty('top');
    try { localStorage.removeItem(storageKey); } catch { /* CSS defaults still apply. */ }
  });

  plant.addEventListener('keydown', event => {
    const step = event.shiftKey ? 24 : 10;
    const movement = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!movement) return;
    event.preventDefault();
    const roomRect = room.getBoundingClientRect();
    const rect = plant.getBoundingClientRect();
    const limits = bounds();
    const left = Math.max(0, Math.min(limits.maxLeft, rect.left - roomRect.left + movement[0]));
    const top = Math.max(0, Math.min(limits.maxTop, rect.top - roomRect.top + movement[1]));
    plant.style.left = left + 'px';
    plant.style.top = top + 'px';
    savePosition(left, top);
  });

  window.addEventListener('resize', () => {
    if (savedPosition) applyPosition(savedPosition.x, savedPosition.y);
  });
})();
