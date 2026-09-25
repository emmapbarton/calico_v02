window.Calico = window.Calico || {};

(() => {
  const HORIZON_DAYS = 180;
  const EPSILON = 0.05;
  const round = value => Math.round((Number(value) || 0) * 100) / 100;
  const time = value => {
    const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
    return match ? Number(match[1]) + Number(match[2]) / 60 : Number.NaN;
  };
  const dateString = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const date = value => new Date(`${value}T00:00:00`);
  const addDays = (value, count) => { const next = new Date(value); next.setDate(next.getDate() + count); return next; };
  const todayFor = value => { const today = new Date(value); today.setHours(0, 0, 0, 0); return today; };
  const priorityRank = occurrence => occurrence.priority === 'hard' || occurrence.priority === 'hard-deadline' ? 0 : occurrence.priority === 'mandatory' ? 1 : occurrence.priority === 'deferred' || occurrence.priority === 'bumped' ? 3 : 2;
  const conflictType = occurrence => priorityRank(occurrence) <= 1 ? 'hard' : 'soft';
  const repeatOn = (task, target) => {
    const start = task.date || task.deadline;
    if (!start || target < start) return false;
    if (target === start) return true;
    const targetDay = date(target).getDay();
    if (task.repeat === 'daily') return true;
    if (task.repeat === 'weekly') return targetDay === date(start).getDay();
    if (task.repeat === 'weekdays') return targetDay >= 1 && targetDay <= 5;
    if (task.repeat === 'weekends') return targetDay === 0 || targetDay === 6;
    if (task.repeat === 'custom') return (task.repeatDays || []).includes(targetDay);
    if (task.repeat === 'interval') return Math.round((date(target) - date(start)) / 86400000) % Math.max(1, Number(task.repeatInterval) || 7) === 0;
    return false;
  };
  const canUseDay = (occurrence, target) => {
    const day = date(target).getDay();
    if (occurrence.repeat === 'weekdays') return day >= 1 && day <= 5;
    if (occurrence.repeat === 'weekends') return day === 0 || day === 6;
    return occurrence.repeat !== 'custom' || (occurrence.repeatDays || []).includes(day);
  };
  const occurrenceOverride = (state, occurrence) => state.manualOverrides?.[occurrence.occId] || {};
  const workingHours = (state, target) => {
    const override = state.dailyWorkingHours?.[target];
    const dayStart = override?.dayStart || state.dayStart || '09:00';
    const dayEnd = override?.dayEnd || state.dayEnd || '18:00';
    return { dayStart, dayEnd, maxDailyHours: Number(override?.maxDailyHours ?? state.maxDailyHours ?? 8) };
  };
  const allocationWeight = (occurrence, index, length, free) => occurrence.dist === 'front' ? length - index : occurrence.dist === 'back' ? index + 1 : occurrence.dist === 'weighted' ? Math.max(0, free) : 1;

  function buildOccurrences(state, days, today) {
    const lastDay = days.at(-1);
    const occurrences = [];
    state.tasks.forEach(task => {
      if (!task?.deadline) return;
      const missed = Object.entries(state.taskLog || {}).reduce((sum, [key, entry]) => {
        const [taskId, loggedDate] = key.split('|');
        return taskId === task.id && loggedDate && date(loggedDate) < today ? sum + Math.max(0, (entry.scheduled || 0) - (entry.completed ?? entry.scheduled ?? 0)) : sum;
      }, 0);
      const taskHours = Math.max(0, Number(task.hours || 0) - Number(task.logged || 0));
      if (!task.repeat || task.repeat === 'none') {
        if (date(task.deadline) >= today) occurrences.push({ taskId: task.id, occId: task.id, windowStart: dateString(today), deadline: task.deadline, hours: taskHours + missed, priority: task.priority || 'mandatory', dist: task.dist === 'inherit' ? state.distribution : task.dist || 'even', notBefore: task.notBefore || null, splittable: task.splittable !== false, minBlockHours: Number(task.minBlockHours || state.minBlockHours || .5), name: task.name, color: task.color });
        return;
      }
      let previous = null; let count = 0;
      for (let cursor = date(task.date || task.deadline); cursor <= date(lastDay); cursor = addDays(cursor, 1)) {
        const target = dateString(cursor);
        if (!repeatOn(task, target)) continue;
        if (task.repeatEndType === 'date' && task.repeatEndDate && target > task.repeatEndDate) break;
        if (task.repeatEndType === 'count' && task.repeatCount && count >= task.repeatCount) break;
        count += 1;
        if (cursor >= today) occurrences.push({ taskId: task.id, occId: `${task.id}|occ|${target}`, windowStart: previous ? dateString(addDays(date(previous), 1)) : dateString(today), deadline: target, hours: taskHours + (count === 1 ? missed : 0), priority: task.priority || 'mandatory', dist: task.dist === 'inherit' ? state.distribution : task.dist || 'even', notBefore: task.notBefore || null, splittable: task.splittable !== false, minBlockHours: Number(task.minBlockHours || state.minBlockHours || .5), repeat: task.repeat, repeatDays: task.repeatDays || [], name: task.name, color: task.color });
        previous = target;
      }
    });
    return occurrences.sort((a, b) => priorityRank(a) - priorityRank(b) || a.deadline.localeCompare(b.deadline) || a.occId.localeCompare(b.occId));
  }

  function allocateOccurrence(state, occurrence, remaining, today) {
    const allocation = {}; const override = occurrenceOverride(state, occurrence);
    const excluded = new Set(override.excludedDates || []); const extraRemaining = {}; let needed = Number(occurrence.hours || 0); let pinShortfall = 0;
    const earliest = date(occurrence.notBefore && occurrence.notBefore > occurrence.windowStart ? occurrence.notBefore : occurrence.windowStart);
    for (let cursor = new Date(earliest); cursor <= date(occurrence.deadline); cursor = addDays(cursor, 1)) {
      const target = dateString(cursor);
      extraRemaining[target] = Math.max(0, Number(state.taskOverworkAllowances?.[`${occurrence.taskId}|${occurrence.deadline}|${target}`] || 0));
    }
    const consume = (target, requested) => {
      const normal = Math.min(remaining[target] || 0, requested); const extra = Math.min(extraRemaining[target] || 0, requested - normal); const used = normal + extra;
      if (used) { remaining[target] = round(Math.max(0, (remaining[target] || 0) - normal)); extraRemaining[target] = round(Math.max(0, (extraRemaining[target] || 0) - extra)); allocation[target] = round((allocation[target] || 0) + used); }
      return used;
    };
    for (let cursor = new Date(earliest); cursor <= date(occurrence.deadline); cursor = addDays(cursor, 1)) {
      const target = dateString(cursor); const pinned = override.pinned?.[target];
      if (pinned === undefined) continue;
      const requested = Math.min(Math.max(0, Number(pinned)), needed); const used = canUseDay(occurrence, target) ? consume(target, requested) : 0;
      needed -= requested; pinShortfall += requested - used; excluded.add(target);
    }
    for (let cursor = new Date(earliest); cursor <= date(occurrence.deadline) && needed > EPSILON; cursor = addDays(cursor, 1)) {
      const target = dateString(cursor); const block = override.timeBlocks?.[target];
      if (override.pinned?.[target] !== undefined || !block || !canUseDay(occurrence, target)) continue;
      const duration = Math.max(0, time(block.end) - time(block.start));
      if (duration <= EPSILON) continue;
      const requested = Math.min(duration, needed); const used = consume(target, requested);
      needed -= requested; pinShortfall += requested - used;
    }
    const candidates = () => {
      const out = [];
      for (let cursor = new Date(earliest); cursor <= date(occurrence.deadline); cursor = addDays(cursor, 1)) {
        const target = dateString(cursor); const free = (remaining[target] || 0) + (extraRemaining[target] || 0);
        if (!excluded.has(target) && canUseDay(occurrence, target) && free + .001 >= Math.min(occurrence.minBlockHours, needed)) out.push({ target, free });
      }
      return out;
    };
    if (needed > EPSILON && occurrence.splittable === false) {
      const usable = candidates().filter(day => day.free + EPSILON >= needed);
      if (usable.length) { const chosen = usable.sort((a, b) => allocationWeight(occurrence, usable.indexOf(b), usable.length, b.free) - allocationWeight(occurrence, usable.indexOf(a), usable.length, a.free))[0]; needed -= consume(chosen.target, needed); }
    }
    let guard = 0;
    while (needed > EPSILON && occurrence.splittable !== false && guard++ < 1000) {
      const usable = candidates(); if (!usable.length) break;
      const block = Math.min(Math.max(.25, occurrence.minBlockHours || .5), needed);
      const selected = usable.slice(0, Math.max(1, Math.floor(needed / block)));
      const weights = selected.map((day, index) => allocationWeight(occurrence, index, selected.length, day.free)); const total = weights.reduce((sum, weight) => sum + weight, 0);
      let progressed = 0;
      selected.forEach((day, index) => { if (needed <= EPSILON) return; const request = Math.min(day.free, needed, Math.max(block, needed * weights[index] / total)); const used = consume(day.target, request); needed -= used; progressed += used; });
      if (progressed <= EPSILON) break;
    }
    needed = round(Math.max(0, needed + pinShortfall));
    const allocated = round(Number(occurrence.hours || 0) - needed);
    return { allocation, allocated, shortfall: needed, fullyAllocated: needed <= EPSILON };
  }

  function allocateSchedule(state, options = {}) {
    const today = todayFor(options.today || new Date());
    let end = addDays(today, HORIZON_DAYS);
    state.tasks.forEach(task => { [task.deadline, task.repeatEndDate].filter(Boolean).forEach(value => { if (date(value) > end) end = date(value); }); });
    end = end > addDays(today, 365) ? addDays(today, 365) : end;
    const days = []; for (let cursor = new Date(today); cursor <= end; cursor = addDays(cursor, 1)) days.push(dateString(cursor));
    const dailyCapacity = {}; const dailyFree = {}; const dailyEvents = {};
    days.forEach(target => {
      const hours = workingHours(state, target); const weekday = date(target).getDay(); const workingWindow = Math.max(0, time(hours.dayEnd) - time(hours.dayStart));
      const base = state.dailyWorkingHours?.[target] ? hours.maxDailyHours : Number(state.weekdayCapacity?.[weekday] ?? state.weekdayCapacity?.[String(weekday)] ?? hours.maxDailyHours);
      dailyCapacity[target] = round(Math.min(24, workingWindow, base) * (Number(state.intensities?.[target] ?? state.baseline ?? 7) / Math.max(1, Number(state.baseline || 7))));
      dailyEvents[target] = window.Calico.state.eventsOnDate(state.events, target);
      dailyFree[target] = round(Math.max(0, dailyCapacity[target] - dailyEvents[target].reduce((sum, event) => sum + (time(event.end) - time(event.start)), 0)));
    });
    const remaining = { ...dailyFree }; const occurrences = buildOccurrences(state, days, today); const occurrenceAllocations = {}; const occurrenceResults = {};
    occurrences.forEach(occurrence => { const result = allocateOccurrence(state, occurrence, remaining, today); occurrenceAllocations[occurrence.occId] = result.allocation; occurrenceResults[occurrence.occId] = result; });
    const allocations = Object.fromEntries((state.tasks || []).map(task => [task.id, {}])); const dailyUsed = {};
    occurrences.forEach(occurrence => Object.entries(occurrenceAllocations[occurrence.occId]).forEach(([target, hours]) => { allocations[occurrence.taskId][target] = round((allocations[occurrence.taskId][target] || 0) + hours); dailyUsed[target] = round((dailyUsed[target] || 0) + hours); }));
    const conflicts = {}; const conflictSummary = { hard: [], soft: [] }; const affectedTasks = [];
    occurrences.forEach(occurrence => { const result = occurrenceResults[occurrence.occId]; if (result.shortfall <= EPSILON) return; const type = conflictType(occurrence); const reason = Object.keys(occurrenceOverride(state, occurrence).pinned || {}).length || (occurrenceOverride(state, occurrence).excludedDates || []).length || Object.keys(occurrenceOverride(state, occurrence).timeBlocks || {}).length ? 'user_constraints' : dailyFree[occurrence.deadline] ? 'insufficient_capacity' : 'event_blocked'; const entry = { taskId: occurrence.taskId, occurrenceId: occurrence.occId, needed: round(occurrence.hours), allocated: result.allocated, shortfall: result.shortfall, originalDeadline: occurrence.deadline, suggested: null, type, reason }; conflictSummary[type].push(entry); if (!affectedTasks.includes(occurrence.taskId)) affectedTasks.push(occurrence.taskId); const existing = conflicts[occurrence.taskId] ||= { taskId: occurrence.taskId, allocated: 0, needed: 0, shortfall: 0, unallocated: 0, type, reason, occurrences: [] }; existing.allocated = round(existing.allocated + result.allocated); existing.needed = round(existing.needed + occurrence.hours); existing.shortfall = round(existing.shortfall + result.shortfall); existing.unallocated = existing.shortfall; if (type === 'hard') existing.type = 'hard'; existing.occurrences.push({ occId: occurrence.occId, deadline: occurrence.deadline, allocated: result.allocated, needed: occurrence.hours, shortfall: result.shortfall, fullyAllocated: result.fullyAllocated, type, reason }); });
    return { allocations, occurrenceAllocations, occurrenceResults, occurrences, conflicts, conflictsByTask: conflicts, conflictSummary, affectedTasks, dailyCapacity, dailyFree, dailyUsed, dailyEvents, window: { from: days[0], to: days.at(-1) } };
  }

  window.Calico.planner = { allocateSchedule, roundHours: round };
})();
