function buildCapacityChip(dayLabel, value, expanded) {
  const display = expanded
    ? `<div class="capacity-chip is-expanded" data-capacity="${value}"><button class="capacity-adjust" type="button" data-capacity-adjust="-1" aria-label="Reduce day capacity"><i data-lucide="minus"></i></button><span class="capacity-value"><i class="capacity-dot"></i>${value}</span><button class="capacity-adjust" type="button" data-capacity-adjust="1" aria-label="Increase day capacity"><i data-lucide="plus"></i></button></div>`
    : `<button class="capacity-chip" type="button" data-capacity="${value}" aria-label="Adjust day capacity"><i class="capacity-dot"></i>${value}</button>`;
  dayLabel.querySelector('.capacity-chip')?.remove();
  dayLabel.insertAdjacentHTML('beforeend', display);
}

function bindCapacity(root) {
  const labels = [...root.querySelectorAll('[data-page="week"] .day-label')];
  [5, 7, 7, 8, 7].forEach((value, index) => {
    const label = labels[index];
    if (!label) return;
    buildCapacityChip(label, value, false);
    label.addEventListener('click', event => {
      const chip = event.target.closest('.capacity-chip');
      if (!chip) return;
      const current = Number(chip.dataset.capacity);
      const adjustment = event.target.closest('[data-capacity-adjust]');
      if (adjustment) {
        buildCapacityChip(label, Math.max(1, Math.min(10, current + Number(adjustment.dataset.capacityAdjust))), true);
      } else {
        labels.forEach(other => {
          if (other !== label) buildCapacityChip(other, Number(other.querySelector('.capacity-chip')?.dataset.capacity || 7), false);
        });
        buildCapacityChip(label, current, true);
      }
      window.lucide?.createIcons();
    });
  });

  const dayPage = root.querySelector('[data-page="day"]');
  const pageHead = dayPage?.querySelector('.page-head');
  if (!pageHead) return;
  pageHead.insertAdjacentHTML('afterend', `
    <section class="day-capacity" aria-label="Today's capacity">
      <span class="day-capacity-label">Today's capacity <i data-lucide="sparkles"></i></span>
      <span class="day-capacity-value"><strong data-day-capacity-value>7</strong>Balanced day</span>
      <span class="capacity-stepper"><button type="button" data-day-capacity-adjust="-1" aria-label="Reduce capacity"><i data-lucide="minus"></i></button><button type="button" data-day-capacity-adjust="1" aria-label="Increase capacity"><i data-lucide="plus"></i></button></span>
      <span class="capacity-levels"><button type="button" data-day-capacity-level="5" aria-pressed="false">Gentle</button><button type="button" data-day-capacity-level="7" aria-pressed="true">Balanced</button><button type="button" data-day-capacity-level="9" aria-pressed="false">Full</button></span>
    </section>`);
  const updateDayCapacity = value => {
    const bounded = Math.max(1, Math.min(10, value));
    dayPage.querySelector('[data-day-capacity-value]').textContent = bounded;
    dayPage.querySelectorAll('[data-day-capacity-level]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.dayCapacityLevel) === bounded)));
  };
  dayPage.querySelectorAll('[data-day-capacity-adjust]').forEach(button => button.addEventListener('click', () => updateDayCapacity(Number(dayPage.querySelector('[data-day-capacity-value]').textContent) + Number(button.dataset.dayCapacityAdjust))));
  dayPage.querySelectorAll('[data-day-capacity-level]').forEach(button => button.addEventListener('click', () => updateDayCapacity(Number(button.dataset.dayCapacityLevel))));
}

function bindPriority(root) {
  const taskForm = root.querySelector('[data-panel="new-item"] [data-item="task"]');
  const options = taskForm?.querySelector('.options-toggle');
  if (!taskForm || !options) return;
  options.insertAdjacentHTML('beforebegin', `<div class="priority-control" aria-label="Task priority"><button type="button" aria-pressed="true"><strong>Mandatory</strong>Needs a realistic plan.</button><button type="button" aria-pressed="false"><strong>Optional</strong>Fills spare capacity.</button></div>`);
  taskForm.querySelectorAll('.priority-control button').forEach(button => button.addEventListener('click', () => taskForm.querySelectorAll('.priority-control button').forEach(other => other.setAttribute('aria-pressed', String(other === button)))));

  const optionalBlock = root.querySelector('[data-page="week"] .task-orange');
  if (optionalBlock) {
    optionalBlock.classList.add('task-optional');
    const detail = optionalBlock.querySelector('small');
    if (detail) detail.textContent = 'Optional · 1h · automatic';
  }
}

function bindRecurrence(root) {
  const taskRepeat = root.querySelector('[data-panel="task-options"] .form-row');
  const eventRepeat = root.querySelector('[data-panel="event-options"] .form-row');
  [[taskRepeat, 'task'], [eventRepeat, 'event']].forEach(([row, type]) => {
    if (!row) return;
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-label', `Edit ${type} recurrence`);
    const open = () => window.Calico.openRepeatOverlay(root, type);
    row.addEventListener('click', open);
    row.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
  });
}

function bindOccurrenceReview(root, navigation) {
  root.querySelectorAll('[data-page="agenda"] .outcome-buttons button').forEach(button => {
    button.addEventListener('click', () => {
      if (button.textContent.trim() === 'Incomplete') window.Calico.openIncompleteOverlay(root);
    });
  });

  const conflict = root.querySelector('[data-panel="conflict"]');
  const body = conflict?.querySelector('.choice-body');
  if (!body) return;
  body.innerHTML = `
    <div class="choice-sheet-head"><div><h1>There isn't enough time on Friday.</h1><p>2.5 hours will not fit before the launch brief is due. Choose how to handle this task.</p></div><button class="close" type="button" aria-label="Close" data-conflict-close><i data-lucide="x"></i></button></div>
    <div class="runtime-section-label">Change the task</div>
    <button class="runtime-choice" type="button"><i data-lucide="calendar-arrow-up"></i><span><strong>Move the deadline</strong><small>Give the work more space in the following week.</small></span><b>›</b></button>
    <button class="runtime-choice" type="button"><i data-lucide="scissors"></i><span><strong>Reduce the estimate</strong><small>Keep the deadline and make the scope fit.</small></span><b>›</b></button>
    <button class="runtime-choice" type="button"><i data-lucide="split"></i><span><strong>Split the work</strong><small>Use shorter sessions for this occurrence only.</small></span><b>›</b></button>
    <div class="runtime-section-label">Choose the placement</div>
    <button class="runtime-choice" type="button" data-open-placement><i data-lucide="calendar-clock"></i><span><strong>Choose another time</strong><small>Assign time to the free slots you select.</small></span><b>›</b></button>
    <button class="runtime-choice" type="button"><i data-lucide="circle-check-big"></i><span><strong>Schedule anyway</strong><small>Keep the task in the plan and show the shortfall.</small></span><b>›</b></button>
    <button class="runtime-choice is-set-aside" type="button"><i data-lucide="archive"></i><span><strong>Set aside for now</strong><small>Keep the task in Calico but take it out of this plan.</small></span><b>›</b></button>
    <div class="runtime-section-label">Make room</div>
    <button class="runtime-choice" type="button"><i data-lucide="clock-arrow-up"></i><span><strong>Add time to selected days</strong><small>Allow more work only where you explicitly choose.</small></span><b>›</b></button>
    <button class="runtime-choice" type="button"><i data-lucide="list-collapse"></i><span><strong>Reprioritise other tasks</strong><small>Let this task take space from selected optional work.</small></span><b>›</b></button>
    <button class="runtime-choice" type="button"><i data-lucide="sparkles"></i><span><strong>Raise capacity on selected days</strong><small>Use a fuller day where it genuinely feels possible.</small></span><b>›</b></button>`;
  body.querySelector('[data-conflict-close]').addEventListener('click', navigation.closePanel);
  body.querySelector('[data-open-placement]').addEventListener('click', () => {
    conflict.classList.remove('is-active');
    window.Calico.openPlacementOverlay(root, () => conflict.classList.add('is-active'));
  });
}

function bindAccount(root) {
  const accountSection = [...root.querySelectorAll('[data-page="settings"] .settings-section')].find(section => section.textContent.trim() === 'Account');
  const accountSetting = accountSection?.nextElementSibling;
  if (!accountSection || !accountSetting) return;
  accountSetting.classList.add('account-setting');
  accountSetting.insertAdjacentHTML('afterend', `<div class="setting sign-out-setting"><div class="setting-copy"><strong>Plan on this device</strong><p>Your local plan remains available after signing out.</p></div><button class="text" type="button" data-sign-out>Sign out</button><i class="chevron" data-lucide="log-out"></i></div>`);
  root.querySelector('[data-sign-out]')?.addEventListener('click', event => {
    event.currentTarget.textContent = 'Signed out';
    event.currentTarget.disabled = true;
  });
}

function boot() {
  const { bindAgenda, bindOverlays, bindSearch, createNavigation, fixture } = window.Calico;
  const root = document.getElementById('calico-design-package');
  const navigation = createNavigation(root, fixture);
  bindOverlays(root, navigation);
  bindAgenda(root, navigation);
  bindSearch(root, fixture);
  bindCapacity(root);
  bindPriority(root);
  bindRecurrence(root);
  bindOccurrenceReview(root, navigation);
  bindAccount(root);
  window.lucide?.createIcons();
}

document.addEventListener('DOMContentLoaded', boot, { once: true });
