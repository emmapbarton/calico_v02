window.Calico = window.Calico || {};

window.Calico.bindUiWiring = function bindUiWiring(root, navigation) {
  const store = window.Calico.store;
  const planner = window.Calico.planner;
  const COLORS = ['#007aff', '#8e68d8', '#e67817', '#2b9c66'];
  const DAY_START = 8;
  const DAY_END = 18;
  let selectedDate = localDate(new Date());
  let activeTaskId = null;
  let activeOccurrenceId = null;
  let activeConflict = null;
  let expandedCapacityDate = null;
  let projectFilter = null;

  function localDate(value) {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function dateFor(iso) {
    return new Date(`${iso}T00:00:00`);
  }

  function addDays(iso, days) {
    const date = dateFor(iso);
    date.setDate(date.getDate() + days);
    return localDate(date);
  }

  function mondayFor(iso) {
    const date = dateFor(iso);
    const offset = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - offset);
    return localDate(date);
  }

  function shortDate(iso) {
    return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric' }).format(dateFor(iso));
  }

  function longDate(iso) {
    return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).format(dateFor(iso));
  }

  function timeLabel(hours) {
    const whole = Math.floor(hours);
    const minutes = Math.round((hours - whole) * 60);
    return `${String(whole).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  function hoursLabel(hours) {
    const rounded = Math.round(Number(hours || 0) * 10) / 10;
    return `${rounded}h`;
  }

  function escape(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  }

  function currentPlan() {
    return planner.allocateSchedule(store.getState());
  }

  function currentWeek() {
    const monday = mondayFor(selectedDate);
    return Array.from({ length: 5 }, (_, index) => addDays(monday, index));
  }

  function projectFor(state, projectId) {
    return state.projects.find(project => project.id === projectId) || null;
  }

  function filterVisible(item) {
    return !projectFilter || item.projectId === projectFilter;
  }

  function showError(panel, message) {
    let messageNode = panel.querySelector('[data-form-error]');
    if (!messageNode) {
      messageNode = document.createElement('p');
      messageNode.className = 'validation';
      messageNode.dataset.formError = '';
      panel.querySelector('.sheet-body')?.appendChild(messageNode);
    }
    messageNode.textContent = message || '';
  }

  function renderPeriod() {
    const activePage = root.querySelector('.page.is-active')?.dataset.page || 'week';
    const period = root.querySelector('.package[data-panel="planner"] .period');
    if (!period) return;
    if (activePage === 'day') {
      period.hidden = false;
      period.textContent = longDate(selectedDate);
      return;
    }
    if (['week', 'agenda', 'review'].includes(activePage)) {
      const week = currentWeek();
      period.hidden = false;
      period.innerHTML = `<b>‹</b>${dateFor(week[0]).getDate()}-${dateFor(week[4]).getDate()} ${new Intl.DateTimeFormat('en-GB', { month: 'short' }).format(dateFor(week[4]))}<b>›</b>`;
      return;
    }
    period.hidden = true;
  }

  function renderSidebar(state) {
    const nav = root.querySelector('.sidebar .projects nav');
    if (!nav) return;
    nav.innerHTML = state.projects.map(project => `
      <button type="button" data-project-filter="${escape(project.id)}" aria-pressed="${projectFilter === project.id}">
        <span class="dot" style="background:${escape(project.color)}"></span>${escape(project.name)}
      </button>`).join('') || '<span class="sidebar-empty">No projects yet</span>';
  }

  function renderFilters(state) {
    const row = root.querySelector('[data-page="week"] .filter-row');
    if (!row) return;
    row.innerHTML = `<span>Show</span>${state.projects.map(project => `<button type="button" data-project-filter="${escape(project.id)}" aria-pressed="${projectFilter === project.id}"><b class="dot" style="background:${escape(project.color)}"></b> ${escape(project.name)}</button>`).join('')}<button class="filter-reset" type="button" data-clear-project-filter>Show all</button>`;
  }

  function capacityChip(date, value) {
    if (expandedCapacityDate === date) {
      return `<div class="capacity-chip is-expanded" data-capacity="${value}" data-capacity-date="${date}"><button class="capacity-adjust" type="button" data-capacity-adjust="-1" aria-label="Reduce day capacity"><i data-lucide="minus"></i></button><span class="capacity-value"><i class="capacity-dot"></i>${value}</span><button class="capacity-adjust" type="button" data-capacity-adjust="1" aria-label="Increase day capacity"><i data-lucide="plus"></i></button></div>`;
    }
    return `<button class="capacity-chip" type="button" data-capacity="${value}" data-capacity-date="${date}" aria-label="Adjust day capacity"><i class="capacity-dot"></i>${value}</button>`;
  }

  function renderWeek(state, plan) {
    const page = root.querySelector('[data-page="week"]');
    const labels = [...page.querySelectorAll('.day-label')];
    const cells = [...page.querySelectorAll('.schedule-cell')];
    const dates = currentWeek();
    labels.forEach((label, index) => {
      const date = dates[index];
      const value = state.intensities[date] ?? state.baseline;
      label.classList.toggle('today', date === localDate(new Date()));
      label.dataset.date = date;
      label.innerHTML = `${new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(dateFor(date)).toUpperCase()}<strong>${dateFor(date).getDate()}</strong>${capacityChip(date, value)}`;
    });
    const axis = page.querySelector('.time-axis');
    if (axis) axis.innerHTML = Array.from({ length: 6 }, (_, index) => `${String(DAY_START + index * 2).padStart(2, '0')}:00`).join('<br>');
    cells.forEach((cell, index) => {
      const date = dates[index];
      const timeline = planner.buildDayTimeline(state, plan, date);
      const items = [
        ...timeline.events.map(entry => ({ ...entry, event: true })),
        ...timeline.taskBlocks.map(entry => ({ ...entry, event: false })),
      ].filter(entry => filterVisible(entry.item)).sort((a, b) => a.start - b.start || a.end - b.end);
      cell.innerHTML = items.map(entry => {
        const duration = Math.max(0.3, entry.end - entry.start);
        const top = Math.max(0, ((entry.start - DAY_START) / (DAY_END - DAY_START)) * 100);
        const height = Math.min(100 - top, (duration / (DAY_END - DAY_START)) * 100);
        const isAvailability = entry.event && entry.item.kind === 'availability';
        const isOptional = !entry.event && entry.item.priority === 'optional';
        const classes = entry.event ? (isAvailability ? 'availability' : 'event') : (isOptional ? 'task-orange task-optional' : 'task-blue');
        const meta = entry.event
          ? `${isAvailability ? 'Reserved' : 'Event'} · ${timeLabel(entry.start)}-${timeLabel(entry.end)}`
          : `Task · ${hoursLabel(entry.hours)} · ${entry.mode}`;
        const target = entry.event ? `data-event-id="${escape(entry.item.id)}"` : `data-task-id="${escape(entry.item.id)}" data-occurrence-id="${escape(entry.occ.occId)}"`;
        const adjust = entry.event ? '' : '<button class="adjust-block-hours" type="button" data-adjust-block>Adjust hours</button>';
        return `<div class="block ${classes}" style="top:${top}%;height:${height}%" ${target}><strong>${escape(entry.item.name)}</strong><small>${escape(meta)}</small>${adjust}</div>`;
      }).join('');
    });
  }

  function renderDay(state, plan) {
    const page = root.querySelector('[data-page="day"]');
    const heading = page.querySelector('.page-head p');
    if (heading) heading.textContent = longDate(selectedDate);
    const timeline = planner.buildDayTimeline(state, plan, selectedDate);
    const entries = [
      ...timeline.events.map(entry => ({ ...entry, event: true })),
      ...timeline.taskBlocks.map(entry => ({ ...entry, event: false })),
    ].filter(entry => filterVisible(entry.item)).sort((a, b) => a.start - b.start || a.end - b.end);
    const list = page.querySelector('.day-list');
    list.innerHTML = entries.length ? entries.map(entry => {
      const isAvailability = entry.event && entry.item.kind === 'availability';
      const isOptional = !entry.event && entry.item.priority === 'optional';
      const classes = entry.event ? (isAvailability ? 'availability' : 'event') : (isOptional ? 'task-orange task-optional' : 'task-blue');
      const meta = entry.event ? `${isAvailability ? 'Reserved' : 'Event'} until ${timeLabel(entry.end)}` : `Task · ${hoursLabel(entry.hours)} · ${entry.mode}`;
      const target = entry.event ? `data-event-id="${escape(entry.item.id)}"` : `data-task-id="${escape(entry.item.id)}" data-occurrence-id="${escape(entry.occ.occId)}"`;
      const adjust = entry.event ? '' : '<button class="adjust-block-hours" type="button" data-adjust-block>Adjust hours</button>';
      return `<div class="day-row"><time>${timeLabel(entry.start)}</time><div class="day-entry ${classes}" ${target}><strong>${escape(entry.item.name)}</strong><small>${escape(meta)}</small>${adjust}</div></div>`;
    }).join('') : '<div class="planner-empty">Nothing is scheduled for this day.</div>';
    const hours = state.dailyWorkingHours[selectedDate] || { dayStart: state.dayStart, dayEnd: state.dayEnd, maxDailyHours: state.maxDailyHours };
    const totalEvents = timeline.events.reduce((sum, entry) => sum + entry.end - entry.start, 0);
    const aside = page.querySelector('.day-aside');
    aside.querySelector('.summary').innerHTML = `<strong>${hours.dayStart}-${hours.dayEnd}</strong>${hoursLabel(plan.dailyCapacity[selectedDate] || 0)} focused work<br>${hoursLabel(totalEvents)} protected space`;
    let capacity = page.querySelector('.day-capacity');
    if (!capacity) {
      capacity = document.createElement('section');
      capacity.className = 'day-capacity';
      page.querySelector('.page-head').insertAdjacentElement('afterend', capacity);
    }
    const value = state.intensities[selectedDate] ?? state.baseline;
    capacity.innerHTML = `<span class="day-capacity-label">Today's capacity</span><span class="day-capacity-value"><strong>${value}</strong></span><span class="capacity-stepper"><button type="button" data-day-capacity-adjust="-1" aria-label="Reduce capacity"><i data-lucide="minus"></i></button><button type="button" data-day-capacity-adjust="1" aria-label="Increase capacity"><i data-lucide="plus"></i></button></span><span class="capacity-levels"><button type="button" data-day-capacity-level="5" aria-pressed="${value === 5}">Gentle</button><button type="button" data-day-capacity-level="7" aria-pressed="${value === 7}">Balanced</button><button type="button" data-day-capacity-level="9" aria-pressed="${value === 9}">Full</button></span>`;
  }

  function renderAgenda(state, plan) {
    const agenda = root.querySelector('[data-page="agenda"] .agenda');
    const dates = currentWeek();
    const rows = [];
    dates.forEach(date => {
      const timeline = planner.buildDayTimeline(state, plan, date);
      const items = [
        ...timeline.taskBlocks.filter(entry => filterVisible(entry.item)).map(entry => ({ ...entry, event: false })),
        ...timeline.events.filter(entry => filterVisible(entry.item)).map(entry => ({ ...entry, event: true })),
      ].sort((a, b) => a.start - b.start);
      if (!items.length) return;
      rows.push(`<div class="agenda-label">${date === localDate(new Date()) ? 'Today' : shortDate(date)}</div>`);
      items.forEach(entry => {
        const project = projectFor(state, entry.item.projectId);
        const target = entry.event ? `data-event-id="${escape(entry.item.id)}"` : `data-task-id="${escape(entry.item.id)}" data-occurrence-id="${escape(entry.occ.occId)}"`;
        const kind = entry.event ? (entry.item.kind === 'availability' ? 'Reserved time' : 'Event') : `Task · ${hoursLabel(entry.hours)}`;
        rows.push(`<button class="agenda-row" type="button" ${target}><span class="check"></span><span><strong>${escape(entry.item.name)}${entry.event ? '' : '<i class="agenda-disclosure" data-lucide="chevron-right"></i>'}</strong><p><span class="dot" style="background:${escape(project?.color || entry.item.color)}"></span> ${escape(project?.name || 'No project')} · ${kind} · ${timeLabel(entry.start)}</p></span><time>${date === localDate(new Date()) ? 'Today' : shortDate(date)}</time></button>`);
      });
    });
    agenda.innerHTML = rows.join('') || '<div class="planner-empty">Add a task or event to start your agenda.</div>';
  }

  function renderReview(state, plan) {
    const agenda = root.querySelector('[data-page="review"] .agenda');
    const conflicts = Object.values(plan.conflicts || {});
    if (!conflicts.length) {
      agenda.innerHTML = '<div class="planner-empty">Nothing needs a decision right now.</div>';
      return;
    }
    agenda.innerHTML = `<div class="agenda-label">Needs your choice</div>${conflicts.map(conflict => {
      const task = state.tasks.find(item => item.id === conflict.taskId);
      return `<div class="agenda-row"><i data-lucide="triangle-alert" style="color:#b26b00" aria-hidden="true"></i><div><strong>${escape(task?.name || 'Task')}</strong><p><span class="dot" style="background:#e67817"></span> ${hoursLabel(conflict.shortfall)} will not fit before ${escape(shortDate(conflict.occurrences[0].deadline))}</p></div><button class="secondary" type="button" data-conflict-task="${escape(conflict.taskId)}">Choose</button></div>`;
    }).join('')}`;
  }

  function renderProjects(state) {
    const page = root.querySelector('[data-page="projects"]');
    const editor = page.querySelector('.project-editor');
    editor.innerHTML = `<div class="project-editor-head"><h2>Your projects</h2><span class="setting-value">${state.projects.length} ${state.projects.length === 1 ? 'project' : 'projects'}</span></div>${state.projects.map(project => {
      const count = state.tasks.filter(task => task.projectId === project.id).length;
      return `<div class="project-row"><b class="project-swatch" style="background:${escape(project.color)}"></b><div class="project-copy"><strong>${escape(project.name)}</strong><small>${count} ${count === 1 ? 'task' : 'tasks'}</small></div><button class="project-action" type="button" data-project-rename="${escape(project.id)}">Rename</button><button class="project-action" type="button" data-project-delete="${escape(project.id)}">Delete</button></div>`;
    }).join('') || '<div class="planner-empty">Projects are optional. Add one when it helps you group work.</div>'}`;
    const heading = page.querySelector('.page-head');
    const action = heading.querySelector('.secondary');
    if (action) {
      action.dataset.newProject = '';
      action.classList.add('project-add');
      action.innerHTML = '<i data-lucide="plus" aria-hidden="true"></i> New project';
    } else if (!heading.querySelector('[data-new-project]')) {
      heading.insertAdjacentHTML('beforeend', '<button class="secondary project-add" type="button" data-new-project><i data-lucide="plus" aria-hidden="true"></i> New project</button>');
    }
  }

  function renderSettings(state) {
    const settings = root.querySelector('[data-page="settings"] .settings');
    const settingValues = settings.querySelectorAll('.setting-value');
    if (settingValues[0]) settingValues[0].textContent = `${state.baseline} / 10`;
    if (settingValues[1]) settingValues[1].textContent = `${state.dayStart}-${state.dayEnd}`;
    if (settingValues[2]) settingValues[2].textContent = `${Math.round(state.minBlockHours * 60)} min`;
    const projectsSetting = [...settings.querySelectorAll('.setting')].find(row => row.textContent.includes('Projects'));
    projectsSetting?.querySelector('.setting-copy p') && (projectsSetting.querySelector('.setting-copy p').textContent = state.projects.map(project => project.name).join(', ') || 'No projects yet');
  }

  function renderTaskDetail(state, plan) {
    const task = state.tasks.find(item => item.id === activeTaskId);
    if (!task) return;
    const detail = root.querySelector('[data-panel="task-detail"]');
    const occurrence = plan.occurrences.find(item => item.occId === activeOccurrenceId) || plan.occurrences.find(item => item.taskId === task.id);
    const allocations = occurrence ? plan.occurrenceAllocations[occurrence.occId] || {} : {};
    const project = projectFor(state, task.projectId);
    const planned = Object.values(allocations).reduce((sum, hours) => sum + hours, 0);
    detail.querySelector('.detail-head h1').textContent = task.name;
    detail.querySelector('.detail-body').innerHTML = `<section class="detail-section"><span>Plan</span><div class="detail-grid"><div>Scheduled<strong>${hoursLabel(planned)} of ${hoursLabel(task.hours)}</strong></div><div>Due<strong>${longDate(task.deadline)}</strong></div></div></section><section class="detail-section"><span>Details</span><div class="detail-grid"><div>Project<strong>${escape(project?.name || 'No project')}</strong></div><div>Priority<strong>${escape(task.priority)}</strong></div><div>Minimum block<strong>${hoursLabel(task.minBlockHours)}</strong></div><div>Scheduling<strong>${task.splittable ? 'Flexible' : 'One block'}</strong></div></div></section><section class="detail-section"><span>Notes</span><p>${escape(task.description || 'No notes added.')}</p></section>`;
    const edit = detail.querySelector('.primary');
    edit.textContent = 'Edit task';
    edit.className = 'primary';
    edit.onclick = () => openTaskEditor(task);
  }

  function openTaskEditor(task) {
    const state = store.getState();
    window.Calico.openRuntimeOverlay(root, 'task-editor', `<section class="runtime-sheet"><header class="sheet-head"><h1>Edit task</h1><button class="close" type="button" data-runtime-close aria-label="Close"><i data-lucide="x"></i></button></header><div class="sheet-body"><label class="runtime-label">Task name<input class="runtime-input" data-edit-name value="${escape(task.name)}"></label><label class="runtime-label">Expected time<input class="runtime-input" data-edit-hours type="number" min="0.5" step="0.5" value="${task.hours}"></label><label class="runtime-label">Due date<input class="runtime-input" data-edit-deadline type="date" value="${task.deadline}"></label><label class="runtime-label">Project<select class="runtime-input" data-edit-project><option value="">No project</option>${state.projects.map(project => `<option value="${escape(project.id)}" ${project.id === task.projectId ? 'selected' : ''}>${escape(project.name)}</option>`).join('')}</select></label><p class="validation" data-runtime-error></p></div><footer class="sheet-foot"><button class="text destructive" type="button" data-edit-delete>Delete task</button><button class="primary" type="button" data-edit-save>Save task</button></footer></section>`, overlay => {
      overlay.querySelector('[data-edit-save]').addEventListener('click', () => {
        const result = store.updateTask(task.id, { name: overlay.querySelector('[data-edit-name]').value, hours: overlay.querySelector('[data-edit-hours]').value, deadline: overlay.querySelector('[data-edit-deadline]').value, projectId: overlay.querySelector('[data-edit-project]').value || null });
        if (!result.ok) { overlay.querySelector('[data-runtime-error]').textContent = result.error; return; }
        overlay.remove();
        renderAll();
      });
      overlay.querySelector('[data-edit-delete]').addEventListener('click', () => { overlay.remove(); confirmDeletion('task', task.id, task.name); });
    });
  }

  function renderAll() {
    const state = store.getState();
    const plan = currentPlan();
    renderSidebar(state);
    renderFilters(state);
    renderPeriod();
    renderWeek(state, plan);
    renderDay(state, plan);
    renderAgenda(state, plan);
    renderReview(state, plan);
    renderProjects(state);
    renderSettings(state);
    if (activeTaskId) renderTaskDetail(state, plan);
    window.lucide?.createIcons();
  }

  function replaceRowControl(row, markup) {
    const existing = row.querySelector('[data-live-control]');
    if (existing) existing.remove();
    row.querySelector('span')?.replaceWith(Object.assign(document.createElement('span'), { innerHTML: markup }));
  }

  function setFormDefaults() {
    const state = store.getState();
    const panel = root.querySelector('[data-panel="new-item"]');
    const due = addDays(localDate(new Date()), 3);
    panel.querySelector('[data-item="task"] .title-input').value = '';
    panel.querySelector('[data-item="event"] .title-input').value = '';
    const taskRows = panel.querySelectorAll('[data-item="task"] .form-row');
    replaceRowControl(taskRows[0], `<select data-live-control="task-project"><option value="">No project</option>${state.projects.map(project => `<option value="${escape(project.id)}">${escape(project.name)}</option>`).join('')}</select>`);
    replaceRowControl(taskRows[1], '<input data-live-control="task-hours" type="number" min="0.5" step="0.5" value="2">');
    replaceRowControl(taskRows[2], `<input data-live-control="task-deadline" type="date" value="${due}">`);
    const eventRows = panel.querySelectorAll('[data-item="event"] .form-row');
    replaceRowControl(eventRows[0], `<input data-live-control="event-date" type="date" value="${selectedDate}">`);
    replaceRowControl(eventRows[1], '<span class="inline-times"><input data-live-control="event-start" type="time" value="14:00"><span>–</span><input data-live-control="event-end" type="time" value="15:00"></span>');
    showError(panel, '');
  }

  function bindNewItemOptions() {
    const panel = root.querySelector('[data-panel="new-item"]');
    const taskForm = panel.querySelector('[data-item="task"]');
    const eventForm = panel.querySelector('[data-item="event"]');
    const tabs = panel.querySelector('.item-tabs');
    const title = panel.querySelector('#new-item-title');
    const footer = panel.querySelector('.sheet-foot');
    const taskButton = taskForm.querySelector('.options-toggle');
    const eventButton = eventForm.querySelector('.options-toggle');
    taskButton.removeAttribute('data-package');
    eventButton.removeAttribute('data-package');
    taskButton.dataset.openTaskOptions = '';
    eventButton.dataset.openEventOptions = '';
    taskButton.insertAdjacentHTML('beforebegin', '<div class="priority-control" aria-label="Task priority"><button type="button" data-task-priority="mandatory" aria-pressed="true"><strong>Mandatory</strong>Needs a realistic plan.</button><button type="button" data-task-priority="optional" aria-pressed="false"><strong>Optional</strong>Fills spare capacity.</button></div>');
    taskForm.insertAdjacentHTML('afterend', `<div class="in-place-task-options" hidden><div class="options-section-title">Scheduling</div><label class="form-row"><i data-lucide="repeat-2"></i><span>Repeat</span><select data-task-repeat><option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="weekdays">Weekdays</option><option value="weekends">Weekends</option></select></label><label class="form-row"><i data-lucide="calendar-plus"></i><span>Do not schedule before</span><input data-task-not-before type="date"></label><label class="form-row"><i data-lucide="blocks"></i><span>Minimum block</span><select data-task-min-block><option value="0.5">30 min</option><option value="1">1 hour</option><option value="1.5">90 min</option><option value="2">2 hours</option></select></label><label class="form-row"><i data-lucide="split"></i><span>Split across days</span><input data-task-splittable type="checkbox" checked></label></div>`);
    eventForm.insertAdjacentHTML('afterend', `<div class="in-place-event-options" hidden><div class="options-section-title">Repeat</div><label class="form-row"><i data-lucide="repeat-2"></i><span>Frequency</span><select data-event-repeat><option value="none">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="weekdays">Weekdays</option><option value="weekends">Weekends</option></select></label></div>`);
    const taskOptions = panel.querySelector('.in-place-task-options');
    const eventOptions = panel.querySelector('.in-place-event-options');
    const showForm = type => {
      panel.classList.remove('is-showing-task-options', 'is-showing-event-options');
      tabs.hidden = false;
      taskForm.classList.toggle('is-active', type === 'task');
      eventForm.classList.toggle('is-active', type === 'event');
      taskOptions.hidden = true;
      eventOptions.hidden = true;
      title.textContent = type === 'task' ? 'New task' : 'New event';
      footer.innerHTML = `<button class="primary" id="new-item-save">Add ${type}</button>`;
      window.lucide?.createIcons();
    };
    const showOptions = type => {
      panel.classList.toggle('is-showing-task-options', type === 'task');
      panel.classList.toggle('is-showing-event-options', type === 'event');
      tabs.hidden = true;
      taskForm.classList.remove('is-active');
      eventForm.classList.remove('is-active');
      taskOptions.hidden = type !== 'task';
      eventOptions.hidden = type !== 'event';
      title.textContent = type === 'task' ? 'Task options' : 'Event options';
      footer.innerHTML = `<button class="text" type="button" data-options-back>Back</button><button class="primary" type="button" data-options-save>Save options</button>`;
      footer.querySelector('[data-options-back]').addEventListener('click', () => showForm(type));
      footer.querySelector('[data-options-save]').addEventListener('click', () => showForm(type));
      window.lucide?.createIcons();
    };
    taskButton.addEventListener('click', () => showOptions('task'));
    eventButton.addEventListener('click', () => showOptions('event'));
    panel.querySelectorAll('[data-task-priority]').forEach(button => button.addEventListener('click', () => {
      panel.querySelectorAll('[data-task-priority]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
    }));
    root.addEventListener('calico:new-item-reset', () => showForm('task'));
  }

  function resetReserveForm() {
    const panel = root.querySelector('[data-panel="reserve"]');
    panel.querySelector('.title-input').value = '';
    const rows = panel.querySelectorAll('.form-row');
    replaceRowControl(rows[0], `<input data-live-control="reserve-date" type="date" value="${selectedDate}">`);
    replaceRowControl(rows[1], '<span class="inline-times"><input data-live-control="reserve-start" type="time" value="12:00"><span>–</span><input data-live-control="reserve-end" type="time" value="13:00"></span>');
    showError(panel, '');
  }

  function bindNewItem() {
    const panel = root.querySelector('[data-panel="new-item"]');
    setFormDefaults();
    root.addEventListener('calico:new-item-reset', setFormDefaults);
    panel.addEventListener('click', event => {
      const save = event.target.closest('#new-item-save');
      if (!save) return;
      const state = store.getState();
      const taskForm = panel.querySelector('[data-item="task"]');
      const isTask = taskForm.classList.contains('is-active');
      const result = isTask
        ? store.createTask({
          name: taskForm.querySelector('.title-input').value,
          projectId: taskForm.querySelector('[data-live-control="task-project"]')?.value || null,
          hours: taskForm.querySelector('[data-live-control="task-hours"]')?.value,
          deadline: taskForm.querySelector('[data-live-control="task-deadline"]')?.value,
          priority: taskForm.querySelector('.priority-control button[aria-pressed="true"]')?.textContent.includes('Optional') ? 'optional' : 'mandatory',
          color: '#007aff',
          repeat: panel.querySelector('[data-task-repeat]')?.value || 'none',
          repeatEndType: 'count',
          repeatCount: 10,
          notBefore: panel.querySelector('[data-task-not-before]')?.value || null,
          minBlockHours: taskForm.parentElement.querySelector('[data-task-min-block]')?.value,
          splittable: taskForm.parentElement.querySelector('[data-task-splittable]')?.checked !== false,
        })
        : store.createEvent({
          name: panel.querySelector('[data-item="event"] .title-input').value,
          date: panel.querySelector('[data-live-control="event-date"]')?.value,
          start: panel.querySelector('[data-live-control="event-start"]')?.value,
          end: panel.querySelector('[data-live-control="event-end"]')?.value,
          kind: 'event',
          repeat: panel.querySelector('[data-event-repeat]')?.value || 'none',
          repeatEndType: 'count',
          repeatCount: 10,
        });
      if (!result.ok) {
        showError(panel, result.error);
        return;
      }
      navigation.closePanel();
      setFormDefaults();
      renderAll();
    });
  }

  function bindReserve() {
    const panel = root.querySelector('[data-panel="reserve"]');
    resetReserveForm();
    root.querySelectorAll('[data-package="reserve"]').forEach(button => button.addEventListener('click', () => setTimeout(resetReserveForm)));
    panel.querySelector('.primary').addEventListener('click', () => {
      const result = store.createEvent({
        name: panel.querySelector('.title-input').value,
        date: panel.querySelector('[data-live-control="reserve-date"]')?.value,
        start: panel.querySelector('[data-live-control="reserve-start"]')?.value,
        end: panel.querySelector('[data-live-control="reserve-end"]')?.value,
        kind: 'availability',
        color: '#6e6e73',
      });
      if (!result.ok) return showError(panel, result.error);
      navigation.closePanel();
      renderAll();
    });
  }

  function bindWorkingHours() {
    const panel = root.querySelector('[data-panel="day-hours"]');
    const refresh = () => {
      const state = store.getState();
      const values = state.dailyWorkingHours[selectedDate] || state;
      panel.querySelector('.sheet-subtitle').textContent = longDate(selectedDate);
      panel.querySelector('.day-hours-grid').innerHTML = `<div><span>Starts</span><input data-hours-start type="time" value="${values.dayStart}"></div><div><span>Ends</span><input data-hours-end type="time" value="${values.dayEnd}"></div><div><span>Task capacity</span><input data-hours-capacity type="number" min="0.5" max="24" step="0.5" value="${values.maxDailyHours}"></div>`;
      showError(panel, '');
    };
    root.querySelectorAll('[data-package="day-hours"]').forEach(button => button.addEventListener('click', () => setTimeout(refresh)));
    panel.querySelector('.primary').addEventListener('click', () => {
      const result = store.setDailyWorkingHours(selectedDate, {
        dayStart: panel.querySelector('[data-hours-start]').value,
        dayEnd: panel.querySelector('[data-hours-end]').value,
        maxDailyHours: panel.querySelector('[data-hours-capacity]').value,
      });
      if (!result.ok) return showError(panel, result.error);
      navigation.closePanel();
      renderAll();
    });
    panel.querySelector('.text').addEventListener('click', () => {
      store.clearDailyWorkingHours(selectedDate);
      navigation.closePanel();
      renderAll();
    });
    refresh();
  }

  function openProjectEditor(project) {
    const isNew = !project;
    const current = project || { name: '', color: COLORS[0] };
    window.Calico.openRuntimeOverlay(root, 'project-editor', `<section class="runtime-sheet project-runtime"><header class="sheet-head"><h1>${isNew ? 'New project' : 'Rename project'}</h1><button class="close" type="button" data-runtime-close aria-label="Close"><i data-lucide="x"></i></button></header><div class="sheet-body"><label class="runtime-label">Name<input class="runtime-input" data-project-name value="${escape(current.name)}" maxlength="60" autofocus></label><span class="runtime-label">Colour</span><div class="colour-picker" data-project-colours>${COLORS.map(color => `<button type="button" style="background:${color}" data-project-colour="${color}" aria-pressed="${color === current.color}"></button>`).join('')}</div><p class="validation" data-runtime-error></p></div><footer class="sheet-foot"><button class="text" type="button" data-runtime-close>Back</button><button class="primary" type="button" data-project-save>${isNew ? 'Add project' : 'Save project'}</button></footer></section>`, overlay => {
      let color = current.color;
      overlay.querySelectorAll('[data-project-colour]').forEach(button => button.addEventListener('click', () => {
        color = button.dataset.projectColour;
        overlay.querySelectorAll('[data-project-colour]').forEach(other => other.setAttribute('aria-pressed', String(other === button)));
      }));
      overlay.querySelector('[data-project-save]').addEventListener('click', () => {
        const result = isNew ? store.createProject({ name: overlay.querySelector('[data-project-name]').value, color }) : store.updateProject(project.id, { name: overlay.querySelector('[data-project-name]').value, color });
        if (!result.ok) { overlay.querySelector('[data-runtime-error]').textContent = result.error; return; }
        overlay.remove();
        renderAll();
      });
    });
  }

  function confirmDeletion(type, id, label) {
    const panel = root.querySelector('[data-panel="confirm-delete"]');
    panel.querySelectorAll('.confirm-tabs').forEach(node => { node.hidden = true; });
    panel.querySelectorAll('[data-confirm-state]').forEach(node => node.classList.remove('is-active'));
    const state = panel.querySelector('[data-confirm-state="reset"]');
    state.classList.add('is-active');
    state.innerHTML = `<h2>Delete ${escape(label)}?</h2><p>${type === 'project' ? 'Tasks will remain in Calico without a project. Their schedule will not change.' : 'This deletes the task and its planned blocks.'}</p><div class="danger-note">This cannot be undone.</div>`;
    const action = panel.querySelector('[data-confirm-action]');
    action.textContent = type === 'project' ? 'Delete project' : 'Delete task';
    action.onclick = () => {
      const result = type === 'project' ? store.deleteProject(id) : store.deleteTask(id);
      if (result.ok) { navigation.closePanel(); renderAll(); }
    };
    navigation.openPanel('confirm-delete');
  }

  function bindProjects() {
    root.addEventListener('click', event => {
      const add = event.target.closest('[data-new-project]');
      if (add) return openProjectEditor(null);
      const rename = event.target.closest('[data-project-rename]');
      if (rename) return openProjectEditor(store.getState().projects.find(project => project.id === rename.dataset.projectRename));
      const remove = event.target.closest('[data-project-delete]');
      if (remove) {
        const project = store.getState().projects.find(item => item.id === remove.dataset.projectDelete);
        if (project) confirmDeletion('project', project.id, project.name);
      }
    });
  }

  function bindCalendarActions() {
    root.addEventListener('click', event => {
      const filter = event.target.closest('[data-project-filter]');
      if (filter) {
        projectFilter = projectFilter === filter.dataset.projectFilter ? null : filter.dataset.projectFilter;
        renderAll();
        return;
      }
      if (event.target.closest('[data-clear-project-filter]')) {
        projectFilter = null;
        renderAll();
        return;
      }
      const chip = event.target.closest('[data-capacity-date]');
      if (chip) {
        const date = chip.dataset.capacityDate;
        const adjustment = event.target.closest('[data-capacity-adjust]');
        if (adjustment) {
          const value = Math.max(1, Math.min(10, Number(chip.dataset.capacity) + Number(adjustment.dataset.capacityAdjust)));
          store.setIntensity(date, value);
        } else expandedCapacityDate = expandedCapacityDate === date ? null : date;
        renderAll();
        return;
      }
      const capacity = event.target.closest('[data-day-capacity-adjust], [data-day-capacity-level]');
      if (capacity) {
        const state = store.getState();
        const current = state.intensities[selectedDate] ?? state.baseline;
        const value = capacity.dataset.dayCapacityLevel ? Number(capacity.dataset.dayCapacityLevel) : current + Number(capacity.dataset.dayCapacityAdjust);
        store.setIntensity(selectedDate, Math.max(1, Math.min(10, value)));
        renderAll();
        return;
      }
      const task = event.target.closest('[data-task-id]');
      if (task) {
        activeTaskId = task.dataset.taskId;
        activeOccurrenceId = task.dataset.occurrenceId || activeTaskId;
        if (event.target.closest('[data-adjust-block]')) {
          openAllocation();
        } else {
          renderTaskDetail(store.getState(), currentPlan());
          navigation.openPanel('task-detail');
        }
        return;
      }
      const eventItem = event.target.closest('[data-event-id]');
      if (eventItem) openEventDetails(eventItem.dataset.eventId);
    });
  }

  function openAllocation() {
    const task = store.getState().tasks.find(item => item.id === activeTaskId);
    const plan = currentPlan();
    const hours = plan.occurrenceAllocations[activeOccurrenceId]?.[selectedDate] || 0;
    window.Calico.openRuntimeOverlay(root, 'allocation', `<section class="runtime-sheet"><header class="sheet-head"><div><h1>Adjust task hours</h1><p class="sheet-subtitle">${escape(task?.name || 'Task')} · ${escape(longDate(selectedDate))}</p></div><button class="close" type="button" data-runtime-close aria-label="Close"><i data-lucide="x"></i></button></header><div class="sheet-body"><p class="choice-body-copy">This change applies only to this scheduled occurrence. Any unassigned time returns to Calico's planner.</p><label class="runtime-label">Hours on this day<input class="runtime-input" type="number" min="0" step="0.5" data-allocation-hours value="${hours}"></label><p class="validation" data-runtime-error></p></div><footer class="sheet-foot"><button class="text" type="button" data-runtime-close>Back</button><button class="primary" type="button" data-allocation-save>Save adjustment</button></footer></section>`, overlay => {
      overlay.querySelector('[data-allocation-save]').addEventListener('click', () => {
        const result = store.setOccurrencePinned(activeOccurrenceId, selectedDate, overlay.querySelector('[data-allocation-hours]').value);
        if (!result.ok) { overlay.querySelector('[data-runtime-error]').textContent = result.error; return; }
        overlay.remove();
        renderAll();
      });
    });
  }

  function openEventDetails(id) {
    const event = store.getState().events.find(item => item.id === id);
    if (!event) return;
    window.Calico.openRuntimeOverlay(root, 'event-detail', `<section class="runtime-sheet"><header class="sheet-head"><div><h1>${escape(event.name)}</h1><p class="sheet-subtitle">${event.kind === 'availability' ? 'Reserved time' : 'Event'} · ${escape(longDate(event.date))}</p></div><button class="close" type="button" data-runtime-close aria-label="Close"><i data-lucide="x"></i></button></header><div class="sheet-body"><div class="detail-grid"><div>Time<strong>${event.start}-${event.end}</strong></div><div>Repeats<strong>${event.repeat || 'none'}</strong></div></div></div><footer class="sheet-foot"><button class="text destructive" type="button" data-event-delete>Delete</button><button class="primary" type="button" data-runtime-close>Done</button></footer></section>`, overlay => {
      overlay.querySelector('[data-event-delete]').addEventListener('click', () => {
        store.deleteEvent(event.id);
        overlay.remove();
        renderAll();
      });
    });
  }

  function bindReview() {
    root.addEventListener('click', event => {
      const choose = event.target.closest('[data-conflict-task]');
      if (!choose) return;
      const plan = currentPlan();
      activeConflict = plan.conflicts[choose.dataset.conflictTask];
      const task = store.getState().tasks.find(item => item.id === choose.dataset.conflictTask);
      activeTaskId = task?.id || null;
      activeOccurrenceId = activeConflict?.occurrences?.[0]?.occId || activeTaskId;
      const conflict = root.querySelector('[data-panel="conflict"]');
      conflict.querySelector('.choice-body').innerHTML = `<div class="choice-sheet-head"><div><h1>There isn't enough time before ${escape(shortDate(activeConflict.occurrences[0].deadline))}.</h1><p>${hoursLabel(activeConflict.shortfall)} will not fit for ${escape(task?.name || 'this task')}. Choose how to handle it.</p></div><button class="close" type="button" data-conflict-close aria-label="Close"><i data-lucide="x"></i></button></div><div class="runtime-section-label">Choose the placement</div><button class="runtime-choice" type="button" data-conflict-adjust><i data-lucide="calendar-clock"></i><span><strong>Choose another time</strong><small>Set the hours for this occurrence yourself.</small></span><b>›</b></button><button class="runtime-choice" type="button" data-conflict-task-detail><i data-lucide="list-checks"></i><span><strong>Review task details</strong><small>Check the due date, estimate, and priority.</small></span><b>›</b></button>`;
      conflict.querySelector('[data-conflict-close]').addEventListener('click', navigation.closePanel);
      conflict.querySelector('[data-conflict-adjust]').addEventListener('click', () => { navigation.closePanel(); openAllocation(); });
      conflict.querySelector('[data-conflict-task-detail]').addEventListener('click', () => { navigation.closePanel(); renderTaskDetail(store.getState(), currentPlan()); navigation.openPanel('task-detail'); });
      navigation.openPanel('conflict');
      window.lucide?.createIcons();
    });
  }

  function bindSearch() {
    const panel = root.querySelector('[data-panel="search-feedback"]');
    const resultState = panel.querySelector('[data-search-state="results"]');
    const emptyState = panel.querySelector('[data-search-state="empty"]');
    const input = resultState.querySelector('input');
    const renderResults = query => {
      const state = store.getState();
      const normalized = query.trim().toLowerCase();
      const matches = [
        ...state.tasks.map(item => ({ item, type: 'Task' })),
        ...state.events.map(item => ({ item, type: item.kind === 'availability' ? 'Reserved time' : 'Event' })),
      ].filter(({ item }) => !normalized || [item.name, item.description, projectFor(state, item.projectId)?.name].filter(Boolean).some(value => value.toLowerCase().includes(normalized)));
      resultState.classList.toggle('is-active', matches.length > 0);
      emptyState.classList.toggle('is-active', matches.length === 0);
      resultState.querySelector('.search-results').innerHTML = matches.map(({ item, type }) => `<button class="search-result" type="button" ${item.type === 'event' ? `data-search-event="${escape(item.id)}"` : `data-search-task="${escape(item.id)}"`}><i data-lucide="${item.type === 'event' ? 'calendar' : 'check-square'}"></i><span><strong>${escape(item.name)}</strong><small>${type}${item.type === 'task' ? ` · due ${escape(shortDate(item.deadline))}` : ` · ${item.start}-${item.end}`}</small></span><i data-lucide="arrow-up-right"></i></button>`).join('');
      emptyState.querySelector('strong').textContent = normalized ? `No matches for “${query}”` : 'No tasks, events, or projects yet';
      window.lucide?.createIcons();
    };
    root.querySelectorAll('[data-package="search-feedback"]').forEach(button => button.addEventListener('click', () => {
      setTimeout(() => { input.value = ''; renderResults(''); input.focus(); });
    }));
    input.addEventListener('input', () => renderResults(input.value));
    panel.addEventListener('click', event => {
      const task = event.target.closest('[data-search-task]');
      if (task) {
        activeTaskId = task.dataset.searchTask;
        activeOccurrenceId = activeTaskId;
        navigation.closePanel();
        renderTaskDetail(store.getState(), currentPlan());
        navigation.openPanel('task-detail');
      }
      const eventItem = event.target.closest('[data-search-event]');
      if (eventItem) { navigation.closePanel(); openEventDetails(eventItem.dataset.searchEvent); }
    });
    renderResults('');
  }

  function bindBackupAndReset() {
    const resetButton = root.querySelector('[data-page="settings"] [data-package="confirm-delete"]');
    resetButton?.addEventListener('click', () => {
      const panel = root.querySelector('[data-panel="confirm-delete"]');
      panel.querySelector('.confirm-tabs').hidden = true;
      panel.querySelectorAll('[data-confirm-state]').forEach(node => node.classList.remove('is-active'));
      const state = panel.querySelector('[data-confirm-state="reset"]');
      state.classList.add('is-active');
      state.innerHTML = '<h2>Reset all Calico data?</h2><p>This removes tasks, events, projects, and planning history from this device.</p><div class="danger-note">Your account connection stays, but this device will begin with an empty plan.</div>';
      const action = panel.querySelector('[data-confirm-action]');
      action.textContent = 'Reset Calico';
      action.onclick = () => { store.resetPlanningData(); navigation.closePanel(); renderAll(); };
    });
    const safety = root.querySelector('[data-panel="data-safety"]');
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/json'; input.hidden = true;
    root.appendChild(input);
    root.querySelector('[data-page="settings"] [data-package="data-safety"]')?.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      const parsed = (() => { try { return JSON.parse(text); } catch (_) { return null; } })();
      const candidate = parsed?.state || parsed;
      if (!window.Calico.state.isCalicoStateDocument(candidate)) return window.alert('This is not a valid Calico backup.');
      const counts = { current: store.getState(), incoming: candidate };
      safety.querySelector('.safety-compare').innerHTML = `<div><span>Tasks</span><strong>${counts.current.tasks.length} → ${candidate.tasks.length}</strong></div><div><span>Events and availability</span><strong>${counts.current.events.length} → ${candidate.events.length}</strong></div><div><span>Projects</span><strong>${counts.current.projects.length} → ${candidate.projects.length}</strong></div><div><span>Account connection</span><strong>Unchanged</strong></div>`;
      safety.querySelector('.primary').onclick = () => { const result = store.restoreBackup(parsed); if (result.ok) { navigation.closePanel(); renderAll(); } };
      navigation.openPanel('data-safety');
    });
  }

  function openPlanningEditor(kind) {
    const state = store.getState();
    const content = kind === 'baseline'
      ? '<label class="runtime-label">Baseline intensity<input class="runtime-input" data-planning-value type="number" min="1" max="10" step="1" value="' + state.baseline + '"></label>'
      : kind === 'hours'
        ? `<label class="runtime-label">Start time<input class="runtime-input" data-planning-start type="time" value="${state.dayStart}"></label><label class="runtime-label">End time<input class="runtime-input" data-planning-end type="time" value="${state.dayEnd}"></label><label class="runtime-label">Maximum task hours<input class="runtime-input" data-planning-capacity type="number" min="0.5" max="24" step="0.5" value="${state.maxDailyHours}"></label>`
        : '<label class="runtime-label">Minimum task block<input class="runtime-input" data-planning-value type="number" min="0.25" max="24" step="0.25" value="' + state.minBlockHours + '"></label>';
    const title = kind === 'baseline' ? 'Baseline intensity' : kind === 'hours' ? 'Default working hours' : 'Minimum task block';
    window.Calico.openRuntimeOverlay(root, `planning-${kind}`, `<section class="runtime-sheet"><header class="sheet-head"><h1>${title}</h1><button class="close" type="button" data-runtime-close aria-label="Close"><i data-lucide="x"></i></button></header><div class="sheet-body">${content}<p class="validation" data-runtime-error></p></div><footer class="sheet-foot"><button class="text" type="button" data-runtime-close>Back</button><button class="primary" type="button" data-planning-save>Save</button></footer></section>`, overlay => {
      overlay.querySelector('[data-planning-save]').addEventListener('click', () => {
        const values = kind === 'baseline'
          ? { baseline: Number(overlay.querySelector('[data-planning-value]').value) }
          : kind === 'hours'
            ? { dayStart: overlay.querySelector('[data-planning-start]').value, dayEnd: overlay.querySelector('[data-planning-end]').value, maxDailyHours: Number(overlay.querySelector('[data-planning-capacity]').value) }
            : { minBlockHours: Number(overlay.querySelector('[data-planning-value]').value) };
        const result = store.updatePlanning(values);
        if (!result.ok) { overlay.querySelector('[data-runtime-error]').textContent = result.error; return; }
        overlay.remove();
        renderAll();
      });
    });
  }

  function bindSettings() {
    const page = root.querySelector('[data-page="settings"]');
    const settingRows = [...page.querySelectorAll('.setting')];
    const mapping = new Map([
      ['Baseline intensity', 'baseline'],
      ['Default working hours', 'hours'],
      ['Minimum task block', 'min-block'],
    ]);
    settingRows.forEach(row => {
      const heading = row.querySelector('.setting-copy strong')?.textContent.trim();
      const kind = mapping.get(heading);
      if (!kind) return;
      row.dataset.planningSetting = kind;
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-label', `Edit ${heading}`);
      const open = () => openPlanningEditor(kind);
      row.addEventListener('click', open);
      row.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
      });
    });
    const account = settingRows.find(row => row.textContent.includes('emma@calico.app'));
    if (account) {
      account.querySelector('.setting-copy strong').textContent = 'Not signed in';
      account.querySelector('.setting-copy p').textContent = 'Email sign-in and device sync will be connected in the auth phase.';
      account.querySelector('.setting-value').textContent = 'Later';
      account.querySelector('.setting-value').style.color = '#6e6e73';
    }
  }

  root.querySelectorAll('[data-page-button]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.pageButton === 'day') selectedDate = localDate(new Date());
    setTimeout(renderAll);
  }));

  root.querySelector('.period')?.addEventListener('click', event => {
    if (!event.target.matches('b')) return;
    selectedDate = addDays(selectedDate, event.target.textContent === '‹' ? -7 : 7);
    renderAll();
  });

  bindNewItemOptions();
  bindNewItem();
  bindReserve();
  bindWorkingHours();
  bindProjects();
  bindCalendarActions();
  bindReview();
  bindSearch();
  bindBackupAndReset();
  bindSettings();
  store.subscribe(renderAll);
  renderAll();
};
