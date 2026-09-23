window.Calico = window.Calico || {};

window.Calico.bindOverlays = function bindOverlays(root, navigation) {
  root.querySelectorAll('.close, [data-close-overlay]').forEach(button => button.addEventListener('click', navigation.closePanel));

  const conflictFooter = root.querySelector('[data-panel="conflict"] .sheet-foot');
  if (conflictFooter) {
    const [dismiss, save] = conflictFooter.querySelectorAll('button');
    if (dismiss) dismiss.hidden = true;
    if (save) save.textContent = 'Save';
  }
};

window.Calico.openRuntimeOverlay = function openRuntimeOverlay(root, name, markup, onOpen) {
  root.querySelector('.runtime-overlay')?.remove();
  const overlay = document.createElement('section');
  overlay.className = 'runtime-overlay';
  overlay.dataset.runtimeOverlay = name;
  overlay.innerHTML = markup;
  root.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.querySelectorAll('[data-runtime-close]').forEach(button => button.addEventListener('click', close));
  onOpen?.(overlay, close);
  window.lucide?.createIcons();
};

window.Calico.openRepeatOverlay = function openRepeatOverlay(root, type) {
  const isEvent = type === 'event';
  const title = isEvent ? 'Repeat event' : 'Repeat task';
  const subtitle = isEvent ? 'School run · Availability · 08:00-09:00' : 'Write launch brief';
  const frequency = isEvent ? 'Weekdays' : 'Weekly';
  const days = isEvent ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] : ['Tue'];
  const ends = isEvent ? '31 July 2026' : 'After 10 times';

  window.Calico.openRuntimeOverlay(root, `repeat-${type}`, `
    <section class="runtime-sheet repeat-sheet">
      <header class="sheet-head"><div><h1>${title}</h1><p class="sheet-subtitle">${subtitle}</p></div><button class="close" type="button" aria-label="Close" data-runtime-close><i data-lucide="x"></i></button></header>
      <div class="sheet-body">
        <div class="repeat-field"><span>Frequency</span><div class="repeat-segmented">${['Daily', 'Weekly', 'Weekdays'].map(value => `<button type="button" data-repeat-frequency aria-pressed="${value === frequency}">${value}</button>`).join('')}</div></div>
        <div class="repeat-field"><span>Repeat on</span><div class="weekday-picker">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => `<button type="button" data-repeat-day aria-pressed="${days.includes(day)}">${day}</button>`).join('')}</div></div>
        <div class="repeat-pair"><div class="repeat-field"><span>Starts</span><div class="repeat-value">19 May 2026</div></div><div class="repeat-field"><span>Ends</span><div class="repeat-value">${ends}</div></div></div>
        <div class="repeat-row"><span>${isEvent ? 'Time' : 'Every N days'}</span><span>${isEvent ? '08:00-09:00' : 'Not selected'}</span></div>
      </div>
      <footer class="sheet-foot"><button class="text" type="button" data-runtime-close>Back</button><button class="primary" type="button" data-runtime-close>Save repeat</button></footer>
    </section>`, overlay => {
      overlay.querySelectorAll('[data-repeat-frequency]').forEach(button => button.addEventListener('click', () => {
        overlay.querySelectorAll('[data-repeat-frequency]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
      }));
      overlay.querySelectorAll('[data-repeat-day]').forEach(button => button.addEventListener('click', () => {
        button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
      }));
    });
};

window.Calico.openIncompleteOverlay = function openIncompleteOverlay(root) {
  window.Calico.openRuntimeOverlay(root, 'incomplete', `
    <section class="runtime-sheet">
      <header class="sheet-head"><div><h1>What should happen next?</h1><p class="sheet-subtitle">Write launch brief · Tuesday, 19 May</p></div><button class="close" type="button" aria-label="Close" data-runtime-close><i data-lucide="x"></i></button></header>
      <div class="sheet-body"><p class="choice-body-copy">This occurrence was not completed. The original task and its other occurrences stay unchanged.</p>
        <button type="button" class="runtime-choice" data-incomplete-action="move"><i data-lucide="calendar-arrow-up"></i><span><strong>Move the deadline</strong><small>Choose a later date. From there, it behaves like any other planned task.</small></span><b>›</b></button>
        <button type="button" class="runtime-choice is-set-aside" data-incomplete-action="set-aside"><i data-lucide="archive"></i><span><strong>Set aside for now</strong><small>Keep the task in Calico but remove this occurrence from the active plan.</small></span><b>›</b></button>
      </div>
    </section>`, (overlay, close) => {
      overlay.querySelectorAll('[data-incomplete-action]').forEach(button => button.addEventListener('click', () => {
        const description = root.querySelector('[data-page="agenda"] .agenda-row p');
        if (description) description.innerHTML = `<span class="dot" style="background:#007aff"></span> Personal · ${button.dataset.incompleteAction === 'move' ? 'moved to Friday, 22 May' : 'set aside for now'}`;
        close();
      }));
    });
};

window.Calico.openPlacementOverlay = function openPlacementOverlay(root, onBack) {
  const days = [
    ['Wednesday, 20 May', '2.5h free', [['11:30-13:00', '1.5h available', 1], ['15:30-16:30', '1h available', 0]]],
    ['Thursday, 21 May', '2h free', [['09:00-11:00', '2h available', 0]]],
    ['Friday, 22 May', '1.5h free', [['10:30-12:00', '1.5h available', 0]]],
    ['Saturday, 23 May', '3h free', [['10:00-13:00', '3h available', 0]]],
    ['Sunday, 24 May', '2h free', [['14:00-16:00', '2h available', 0]]],
  ];
  const extra = [['Monday, 25 May', '3h free', [['09:00-12:00', '3h available', 0]]], ['Tuesday, 26 May', '2h free', [['13:00-15:00', '2h available', 0]]]];
  const renderDay = ([date, free, slots]) => `<div class="slot-day"><div class="slot-date"><strong>${date}</strong><span>${free}</span></div>${slots.map(([time, available, value]) => `<div class="slot-row"><span>${time}</span><span>${available}</span><div class="slot-stepper"><button type="button" aria-label="Reduce assigned time" data-slot-adjust="-1"><i data-lucide="minus"></i></button><strong data-slot-value>${value}h</strong><button type="button" aria-label="Add assigned time" data-slot-adjust="1"><i data-lucide="plus"></i></button></div></div>`).join('')}</div>`;

  window.Calico.openRuntimeOverlay(root, 'placement', `
    <section class="runtime-sheet placement-sheet">
      <header class="sheet-head"><div><h1>Choose another time</h1><p class="sheet-subtitle">Write launch brief · 4h remaining</p></div><button class="close" type="button" aria-label="Close" data-runtime-close><i data-lucide="x"></i></button></header>
      <div class="sheet-body"><div class="placement-summary"><span>Assigned to this occurrence</span><strong data-placement-total>1h of 4h</strong></div>${days.map(renderDay).join('')}<div class="extra-slot-days">${extra.map(renderDay).join('')}</div><button type="button" class="show-more-days" data-show-more>Show 2 more calendar days <i data-lucide="chevron-down"></i></button></div>
      <footer class="sheet-foot"><button class="text" type="button" data-runtime-back>Back</button><button class="primary" type="button" data-runtime-close>Save time</button></footer>
    </section>`, overlay => {
      const updateTotal = () => {
        const total = [...overlay.querySelectorAll('[data-slot-value]')].reduce((sum, node) => sum + Number.parseFloat(node.textContent), 0);
        overlay.querySelector('[data-placement-total]').textContent = `${total}h of 4h`;
      };
      overlay.querySelectorAll('[data-slot-adjust]').forEach(button => button.addEventListener('click', () => {
        const value = button.parentElement.querySelector('[data-slot-value]');
        const next = Math.max(0, Math.min(4, Number.parseFloat(value.textContent) + Number(button.dataset.slotAdjust)));
        value.textContent = `${next}h`;
        updateTotal();
      }));
      overlay.querySelector('[data-show-more]').addEventListener('click', event => {
        const extraDays = overlay.querySelector('.extra-slot-days');
        const open = extraDays.classList.toggle('is-open');
        event.currentTarget.innerHTML = `${open ? 'Show fewer calendar days' : 'Show 2 more calendar days'} <i data-lucide="chevron-${open ? 'up' : 'down'}"></i>`;
        window.lucide?.createIcons();
      });
      overlay.querySelector('[data-runtime-back]')?.addEventListener('click', () => {
        overlay.remove();
        onBack?.();
      });
    });
};
