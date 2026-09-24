window.Calico = window.Calico || {};

(() => {
  const STATE_VERSION = 6;
  const STORAGE_KEY = 'calico_v02';
  const UNASSIGNED_PROJECT_ID = '__unassigned__';
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  const HEX_COLOR = /^#[0-9a-f]{6}$/i;
  const PRIORITIES = new Set(['mandatory', 'optional', 'hard', 'hard-deadline', 'deferred', 'bumped']);
  const DISTRIBUTIONS = new Set(['inherit', 'even', 'front', 'back', 'weighted']);
  const REPEATS = new Set(['none', 'daily', 'weekly', 'weekdays', 'weekends', 'custom', 'interval']);

  const DEFAULT_STATE = Object.freeze({
    stateVersion: STATE_VERSION,
    onboarded: false,
    baseline: 7,
    distribution: 'even',
    dayStart: '09:00',
    dayEnd: '18:00',
    maxDailyHours: 8,
    weekdayCapacity: {},
    dailyWorkingHours: {},
    minBlockHours: 0.5,
    splitTasks: true,
    taskOverworkAllowances: {},
    view: 'week',
    weekOffset: 0,
    dayOffset: 0,
    projects: [],
    hiddenProjectIds: [],
    tasks: [],
    events: [],
    intensities: {},
    intensityHistory: [],
    nudgeDismissed: false,
    taskLog: {},
    lastCheckinDate: null,
    account: { revision: 0, lastSyncAt: null, lastError: '', email: '' },
    manualOverrides: {},
  });

  const clone = value => JSON.parse(JSON.stringify(value));
  const finiteNumber = (value, fallback, min, max) => {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  };
  const safeColor = (value, fallback = '#3f3f3f') => HEX_COLOR.test(String(value || '')) ? String(value) : fallback;
  const isIsoDate = value => ISO_DATE.test(String(value || ''));
  const timeToHours = value => {
    const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
    if (!match) return Number.NaN;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    return hours <= 23 && minutes <= 59 ? hours + (minutes / 60) : Number.NaN;
  };
  const eventTimeRangeIsValid = (start, end) => {
    const startHours = timeToHours(start);
    const endHours = timeToHours(end);
    return Number.isFinite(startHours) && Number.isFinite(endHours) && endHours > startHours;
  };
  const dayTimestamp = date => {
    if (!isIsoDate(date)) return Number.NaN;
    const [year, month, day] = date.split('-').map(Number);
    const timestamp = Date.UTC(year, month - 1, day);
    const roundTrip = new Date(timestamp);
    return roundTrip.getUTCFullYear() === year && roundTrip.getUTCMonth() === month - 1 && roundTrip.getUTCDate() === day
      ? timestamp : Number.NaN;
  };
  const dayOfWeek = date => Number.isFinite(dayTimestamp(date)) ? new Date(dayTimestamp(date)).getUTCDay() : Number.NaN;
  const workingHoursSettings = (dayStart, dayEnd, maxDailyHours, minBlockHours) => {
    if (!eventTimeRangeIsValid(dayStart, dayEnd)) return null;
    return {
      dayStart,
      dayEnd,
      maxDailyHours: finiteNumber(maxDailyHours, 8, 0.5, 24),
      minBlockHours: finiteNumber(minBlockHours, 0.5, 0.25, 24),
    };
  };
  const createId = () => globalThis.crypto?.randomUUID?.() || `calico-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  function normalizeState(input) {
    const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const next = { ...clone(DEFAULT_STATE), ...raw, stateVersion: STATE_VERSION };
    next.baseline = finiteNumber(next.baseline, 7, 1, 10);
    next.maxDailyHours = finiteNumber(next.maxDailyHours, 8, 0.5, 24);
    next.minBlockHours = finiteNumber(next.minBlockHours, 0.5, 0.25, 24);
    Object.assign(next, workingHoursSettings(next.dayStart, next.dayEnd, next.maxDailyHours, next.minBlockHours)
      || workingHoursSettings(DEFAULT_STATE.dayStart, DEFAULT_STATE.dayEnd, DEFAULT_STATE.maxDailyHours, next.minBlockHours));
    next.splitTasks = next.splitTasks !== false;
    next.weekOffset = Math.trunc(finiteNumber(next.weekOffset, 0, -520, 520));
    next.dayOffset = Math.trunc(finiteNumber(next.dayOffset, 0, -3650, 3650));
    next.distribution = DISTRIBUTIONS.has(next.distribution) && next.distribution !== 'inherit' ? next.distribution : 'even';
    next.view = ['week', 'day', 'agenda', 'review', 'settings', 'projects'].includes(next.view) ? next.view : 'week';

    next.weekdayCapacity = next.weekdayCapacity && typeof next.weekdayCapacity === 'object' ? next.weekdayCapacity : {};
    for (let day = 0; day < 7; day += 1) {
      const value = next.weekdayCapacity[day] ?? next.weekdayCapacity[String(day)];
      if (value !== undefined) next.weekdayCapacity[String(day)] = finiteNumber(value, next.maxDailyHours, 0, 24);
    }
    next.dailyWorkingHours = next.dailyWorkingHours && typeof next.dailyWorkingHours === 'object' ? next.dailyWorkingHours : {};
    Object.entries(next.dailyWorkingHours).forEach(([date, value]) => {
      const normalized = workingHoursSettings(value?.dayStart, value?.dayEnd, value?.maxDailyHours, next.minBlockHours);
      if (!isIsoDate(date) || !normalized) delete next.dailyWorkingHours[date];
      else next.dailyWorkingHours[date] = { dayStart: normalized.dayStart, dayEnd: normalized.dayEnd, maxDailyHours: normalized.maxDailyHours };
    });

    const seenIds = new Set();
    next.projects = (Array.isArray(next.projects) ? next.projects : []).filter(Boolean).map((project, index) => {
      const baseId = String(project?.id || `project-${index + 1}`);
      let id = baseId;
      let suffix = 2;
      while (seenIds.has(id) || id === UNASSIGNED_PROJECT_ID) id = `${baseId}-${suffix++}`;
      seenIds.add(id);
      return {
        id,
        name: String(project?.name || 'Untitled project').trim().slice(0, 60) || 'Untitled project',
        color: safeColor(project?.color),
      };
    });
    const validProjectIds = new Set(next.projects.map(project => project.id));
    next.tasks = (Array.isArray(next.tasks) ? next.tasks : []).filter(Boolean).map(task => ({
      ...task,
      type: 'task',
      projectId: validProjectIds.has(task?.projectId) ? task.projectId : null,
    }));
    next.events = (Array.isArray(next.events) ? next.events : []).filter(Boolean).map(event => ({
      ...event,
      type: 'event',
      kind: event?.kind === 'availability' ? 'availability' : 'event',
    }));
    next.hiddenProjectIds = Array.isArray(next.hiddenProjectIds)
      ? [...new Set(next.hiddenProjectIds.filter(id => id === UNASSIGNED_PROJECT_ID || validProjectIds.has(id)))] : [];
    next.intensities = next.intensities && typeof next.intensities === 'object' ? next.intensities : {};
    next.intensityHistory = Array.isArray(next.intensityHistory) ? next.intensityHistory.slice(-30) : [];
    next.taskLog = next.taskLog && typeof next.taskLog === 'object' ? next.taskLog : {};
    next.taskOverworkAllowances = next.taskOverworkAllowances && typeof next.taskOverworkAllowances === 'object' ? next.taskOverworkAllowances : {};
    next.manualOverrides = next.manualOverrides && typeof next.manualOverrides === 'object' && !Array.isArray(next.manualOverrides) ? next.manualOverrides : {};
    const legacyPins = raw.pinnedAllocations && typeof raw.pinnedAllocations === 'object' ? raw.pinnedAllocations : {};
    Object.entries(legacyPins).forEach(([key, hours]) => {
      const splitAt = key.lastIndexOf('|');
      if (splitAt < 0) return;
      const taskId = key.slice(0, splitAt);
      const date = key.slice(splitAt + 1);
      const task = next.tasks.find(candidate => candidate.id === taskId);
      if (!task || (task.repeat && task.repeat !== 'none') || !isIsoDate(date)) return;
      next.manualOverrides[taskId] ||= { pinned: {}, excludedDates: [] };
      next.manualOverrides[taskId].pinned ||= {};
      next.manualOverrides[taskId].pinned[date] = finiteNumber(hours, 0, 0, 24);
    });
    Object.entries(next.manualOverrides).forEach(([key, source]) => {
      const override = source && typeof source === 'object' && !Array.isArray(source) ? { ...source } : {};
      next.manualOverrides[key] = override;
      override.pinned = override.pinned && typeof override.pinned === 'object' ? override.pinned : {};
      Object.entries(override.pinned).forEach(([date, hours]) => { override.pinned[date] = finiteNumber(hours, 0, 0, 24); });
      override.excludedDates = Array.isArray(override.excludedDates) ? [...new Set(override.excludedDates.filter(isIsoDate))] : [];
      override.timeBlocks = override.timeBlocks && typeof override.timeBlocks === 'object' ? override.timeBlocks : {};
      Object.entries(override.timeBlocks).forEach(([date, block]) => {
        if (!isIsoDate(date) || !['fixed', 'preferred'].includes(block?.mode) || !eventTimeRangeIsValid(block?.start, block?.end)) delete override.timeBlocks[date];
        else override.timeBlocks[date] = { start: block.start, end: block.end, mode: block.mode };
      });
    });
    next.account = next.account && typeof next.account === 'object' ? next.account : {};
    next.account.revision = Math.max(0, Math.trunc(finiteNumber(next.account.revision, 0, 0, Number.MAX_SAFE_INTEGER)));
    next.account.lastSyncAt = next.account.lastSyncAt || null;
    next.account.lastError = String(next.account.lastError || '');
    next.account.email = String(next.account.email || '');
    delete next.cloud;
    delete next.pinnedAllocations;
    delete next.dayCapOverrides;
    return next;
  }

  function validateProject(input, state, existingId) {
    const name = String(input?.name || '').trim();
    if (!name) return { ok: false, error: 'Project name cannot be empty.' };
    const duplicate = state.projects.find(project => project.id !== existingId && project.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (duplicate) return { ok: false, error: 'A project with this name already exists.' };
    return { ok: true, value: { name: name.slice(0, 60), color: safeColor(input?.color) } };
  }

  function validateTask(input, state, existingId) {
    const name = String(input?.name || '').trim();
    const hours = Number(input?.hours);
    if (!name) return { ok: false, error: 'Task name cannot be empty.' };
    if (!Number.isFinite(hours) || hours < 0.5) return { ok: false, error: 'Expected time must be at least 0.5 hours.' };
    if (!isIsoDate(input?.deadline)) return { ok: false, error: 'A valid due date is required.' };
    if (input?.notBefore && !isIsoDate(input.notBefore)) return { ok: false, error: 'Do not schedule before must be a valid date.' };
    if (input?.notBefore && input.notBefore > input.deadline) return { ok: false, error: 'Do not schedule before cannot be after the due date.' };
    if (input?.projectId && !state.projects.some(project => project.id === input.projectId)) return { ok: false, error: 'Choose an existing project.' };
    const repeat = REPEATS.has(input?.repeat) ? input.repeat : 'none';
    const repeatDays = Array.isArray(input?.repeatDays) ? [...new Set(input.repeatDays.map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))] : [];
    const value = {
      id: existingId || createId(),
      type: 'task',
      name: name.slice(0, 120),
      priority: PRIORITIES.has(input?.priority) ? input.priority : 'mandatory',
      color: safeColor(input?.color, '#007aff'),
      projectId: input?.projectId || null,
      description: String(input?.description || '').trim(),
      deadline: input.deadline,
      date: input.deadline,
      hours,
      logged: Number.isFinite(Number(input?.logged)) ? Number(input.logged) : 0,
      dist: DISTRIBUTIONS.has(input?.dist) ? input.dist : 'inherit',
      minBlockHours: finiteNumber(input?.minBlockHours, state.minBlockHours, 0.25, 24),
      splittable: input?.splittable !== false,
      notBefore: input?.notBefore || null,
      repeat,
    };
    if (repeat !== 'none') {
      value.repeatEndType = input?.repeatEndType === 'date' ? 'date' : 'count';
      if (value.repeatEndType === 'date') {
        if (!isIsoDate(input?.repeatEndDate) || input.repeatEndDate < value.deadline) return { ok: false, error: 'Repeat end date must be on or after the first occurrence.' };
        value.repeatEndDate = input.repeatEndDate;
      } else value.repeatCount = Math.max(1, Math.trunc(finiteNumber(input?.repeatCount, 10, 1, 10000)));
      if (repeat === 'custom') value.repeatDays = repeatDays;
      if (repeat === 'interval') value.repeatInterval = Math.max(1, Math.trunc(finiteNumber(input?.repeatInterval, 7, 1, 3650)));
    }
    return { ok: true, value };
  }

  function validateEvent(input, existingId) {
    const name = String(input?.name || '').trim();
    const date = String(input?.date || '');
    const start = String(input?.start || '');
    const end = String(input?.end || '');
    if (!name) return { ok: false, error: 'Event name cannot be empty.' };
    if (!isIsoDate(date) || !Number.isFinite(dayTimestamp(date))) return { ok: false, error: 'A valid event date is required.' };
    if (!eventTimeRangeIsValid(start, end)) return { ok: false, error: 'Event end must be later than its start.' };
    const repeat = REPEATS.has(input?.repeat) ? input.repeat : 'none';
    const repeatDays = Array.isArray(input?.repeatDays) ? [...new Set(input.repeatDays.map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))] : [];
    const value = {
      id: existingId || createId(),
      type: 'event',
      kind: input?.kind === 'availability' ? 'availability' : 'event',
      name: name.slice(0, 120),
      priority: PRIORITIES.has(input?.priority) ? input.priority : 'mandatory',
      color: safeColor(input?.color, '#8e68d8'),
      date,
      start,
      end,
      repeat,
    };
    if (repeat !== 'none') {
      value.repeatEndType = input?.repeatEndType === 'date' ? 'date' : 'count';
      if (value.repeatEndType === 'date') {
        if (!isIsoDate(input?.repeatEndDate) || !Number.isFinite(dayTimestamp(input.repeatEndDate)) || input.repeatEndDate < date) {
          return { ok: false, error: 'Repeat end date must be on or after the first occurrence.' };
        }
        value.repeatEndDate = input.repeatEndDate;
      } else value.repeatCount = Math.max(1, Math.trunc(finiteNumber(input?.repeatCount, 10, 1, 10000)));
      if (repeat === 'custom') {
        if (!repeatDays.length) return { ok: false, error: 'Choose at least one repeat day.' };
        value.repeatDays = repeatDays;
      }
      if (repeat === 'interval') value.repeatInterval = Math.max(1, Math.trunc(finiteNumber(input?.repeatInterval, 7, 1, 3650)));
    }
    return { ok: true, value };
  }

  function eventOccursOn(event, date) {
    if (!event || !isIsoDate(date) || !Number.isFinite(dayTimestamp(date)) || !isIsoDate(event.date) || !Number.isFinite(dayTimestamp(event.date))) return false;
    if (!event.repeat || event.repeat === 'none') return event.date === date;
    if (date < event.date) return false;
    if (event.repeatEndType === 'date' && event.repeatEndDate && date > event.repeatEndDate) return false;
    if (date === event.date) return true;
    const targetDay = dayOfWeek(date);
    const startDay = dayOfWeek(event.date);
    if (event.repeat === 'daily') return true;
    if (event.repeat === 'weekly') return targetDay === startDay;
    if (event.repeat === 'weekdays') return targetDay >= 1 && targetDay <= 5;
    if (event.repeat === 'weekends') return targetDay === 0 || targetDay === 6;
    if (event.repeat === 'custom') return (event.repeatDays || []).includes(targetDay);
    if (event.repeat === 'interval') {
      const interval = Math.max(1, Number(event.repeatInterval) || 7);
      return Math.round((dayTimestamp(date) - dayTimestamp(event.date)) / 86400000) % interval === 0;
    }
    return false;
  }

  function occurrenceCountBefore(event, date) {
    if (!event?.repeat || event.repeat === 'none' || !Number.isFinite(dayTimestamp(event.date)) || !Number.isFinite(dayTimestamp(date))) return 0;
    let count = 0;
    for (let timestamp = dayTimestamp(event.date); timestamp < dayTimestamp(date); timestamp += 86400000) {
      if (eventOccursOn(event, new Date(timestamp).toISOString().slice(0, 10))) count += 1;
    }
    return count;
  }

  function eventsOnDate(events, date) {
    return (Array.isArray(events) ? events : []).filter(event => (
      eventTimeRangeIsValid(event?.start, event?.end)
      && eventOccursOn(event, date)
      && (event.repeatEndType !== 'count' || !event.repeatCount || occurrenceCountBefore(event, date) < event.repeatCount)
    ));
  }

  function createStore({ storage = globalThis.localStorage, key = STORAGE_KEY } = {}) {
    const listeners = new Set();
    let recoveryMessage = '';
    let lastPersistError = '';
    let state;
    const emit = () => listeners.forEach(listener => listener(clone(state)));
    const persist = () => {
      try {
        storage?.setItem(key, JSON.stringify(state));
        lastPersistError = '';
        return true;
      } catch (_) {
        lastPersistError = 'Calico could not save locally. Your changes remain open in this browser.';
        return false;
      }
    };
    const load = () => {
      try {
        const raw = storage?.getItem(key);
        state = normalizeState(raw ? JSON.parse(raw) : DEFAULT_STATE);
        persist();
      } catch (_) {
        try {
          const broken = storage?.getItem(key);
          if (broken) storage?.setItem(`${key}_recovery_${Date.now()}`, broken);
        } catch (_) {}
        state = normalizeState(DEFAULT_STATE);
        recoveryMessage = 'Saved data was damaged, so Calico opened a clean recovery state.';
        persist();
      }
      return clone(state);
    };
    const commit = next => {
      state = normalizeState(next);
      persist();
      emit();
      return clone(state);
    };
    load();
    return {
      getState: () => clone(state),
      getRecoveryMessage: () => recoveryMessage,
      getLastPersistError: () => lastPersistError,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      replace: commit,
      createProject(input) {
        const result = validateProject(input, state);
        if (!result.ok) return result;
        const project = { id: createId(), ...result.value };
        commit({ ...state, projects: [...state.projects, project] });
        return { ok: true, value: clone(project) };
      },
      updateProject(id, input) {
        const existing = state.projects.find(project => project.id === id);
        if (!existing) return { ok: false, error: 'Project not found.' };
        const result = validateProject({ ...existing, ...input }, state, id);
        if (!result.ok) return result;
        const project = { id, ...result.value };
        commit({ ...state, projects: state.projects.map(candidate => candidate.id === id ? project : candidate) });
        return { ok: true, value: clone(project) };
      },
      deleteProject(id) {
        if (!state.projects.some(project => project.id === id)) return { ok: false, error: 'Project not found.' };
        commit({
          ...state,
          projects: state.projects.filter(project => project.id !== id),
          tasks: state.tasks.map(task => task.projectId === id ? { ...task, projectId: null } : task),
          hiddenProjectIds: state.hiddenProjectIds.filter(projectId => projectId !== id),
        });
        return { ok: true };
      },
      createTask(input) {
        const result = validateTask(input, state);
        if (!result.ok) return result;
        commit({ ...state, tasks: [...state.tasks, result.value] });
        return { ok: true, value: clone(result.value) };
      },
      updateTask(id, input) {
        const existing = state.tasks.find(task => task.id === id);
        if (!existing) return { ok: false, error: 'Task not found.' };
        const result = validateTask({ ...existing, ...input, logged: existing.logged }, state, id);
        if (!result.ok) return result;
        commit({ ...state, tasks: state.tasks.map(task => task.id === id ? result.value : task) });
        return { ok: true, value: clone(result.value) };
      },
      deleteTask(id) {
        if (!state.tasks.some(task => task.id === id)) return { ok: false, error: 'Task not found.' };
        const manualOverrides = { ...state.manualOverrides };
        Object.keys(manualOverrides).forEach(key => {
          if (key === id || key.startsWith(`${id}|occ|`)) delete manualOverrides[key];
        });
        commit({ ...state, tasks: state.tasks.filter(task => task.id !== id), manualOverrides });
        return { ok: true };
      },
      createEvent(input) {
        const result = validateEvent(input);
        if (!result.ok) return result;
        commit({ ...state, events: [...state.events, result.value] });
        return { ok: true, value: clone(result.value) };
      },
      updateEvent(id, input) {
        const existing = state.events.find(event => event.id === id);
        if (!existing) return { ok: false, error: 'Event not found.' };
        const result = validateEvent({ ...existing, ...input }, id);
        if (!result.ok) return result;
        commit({ ...state, events: state.events.map(event => event.id === id ? result.value : event) });
        return { ok: true, value: clone(result.value) };
      },
      deleteEvent(id) {
        if (!state.events.some(event => event.id === id)) return { ok: false, error: 'Event not found.' };
        commit({ ...state, events: state.events.filter(event => event.id !== id) });
        return { ok: true };
      },
    };
  }

  window.Calico.state = { DEFAULT_STATE, STORAGE_KEY, normalizeState, validateProject, validateTask, validateEvent, createStore, eventTimeRangeIsValid, eventOccursOn, eventsOnDate, workingHoursSettings };
})();
