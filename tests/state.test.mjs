import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../js/state.js', import.meta.url), 'utf8');
const context = vm.createContext({ window: { Calico: {} }, console, Date, JSON, Math, Number, String, Array, Object, Set, RegExp, globalThis: {} });
vm.runInContext(code, context);
const { state: domain } = context.window.Calico;

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    entries: () => Object.fromEntries(values),
  };
}

test('v02 starts clean and does not read v01 local storage', () => {
  const storage = memoryStorage({ calico_v2: JSON.stringify({ tasks: [{ id: 'v01-task' }] }) });
  const store = domain.createStore({ storage });
  assert.equal(store.getState().tasks.length, 0);
  assert.equal(store.getState().stateVersion, 6);
});

test('normalisation preserves projects and clears orphan task references', () => {
  const state = domain.normalizeState({
    projects: [{ id: 'project', name: '  Harbour launch ', color: '#8e68d8' }, { id: 'project', name: '', color: 'invalid' }],
    tasks: [{ id: 'task', projectId: 'missing' }],
    manualOverrides: { task: { excludedDates: ['bad', '2026-09-24'], timeBlocks: { '2026-09-24': { start: '09:00', end: '08:00', mode: 'fixed' } } } },
  });
  assert.deepEqual(Array.from(state.projects, project => project.id), ['project', 'project-2']);
  assert.equal(state.projects[0].name, 'Harbour launch');
  assert.equal(state.tasks[0].projectId, null);
  assert.deepEqual(Array.from(state.manualOverrides.task.excludedDates), ['2026-09-24']);
  assert.deepEqual({ ...state.manualOverrides.task.timeBlocks }, {});
});

test('normalisation repairs malformed manual overrides instead of failing to load', () => {
  const state = domain.normalizeState({ manualOverrides: { task: null, next: 'invalid' } });
  assert.equal(JSON.stringify(state.manualOverrides.task), JSON.stringify({ pinned: {}, excludedDates: [], timeBlocks: {} }));
  assert.equal(JSON.stringify(state.manualOverrides.next), JSON.stringify({ pinned: {}, excludedDates: [], timeBlocks: {} }));
});

test('a legacy single-occurrence pin is safely converted to an occurrence override', () => {
  const state = domain.normalizeState({
    tasks: [{ id: 'brief', repeat: 'none' }],
    pinnedAllocations: { 'brief|2026-09-24': 1.5 },
  });
  assert.equal(state.manualOverrides.brief.pinned['2026-09-24'], 1.5);
});

test('project operations persist locally and unassign related tasks on delete', () => {
  const storage = memoryStorage();
  const store = domain.createStore({ storage, key: 'calico_test' });
  const project = store.createProject({ name: 'Studio', color: '#e67817' });
  assert.equal(project.ok, true);
  const task = store.createTask({ name: 'Client notes', hours: 2, deadline: '2026-09-25', projectId: project.value.id });
  assert.equal(task.ok, true);
  assert.equal(store.deleteProject(project.value.id).ok, true);
  assert.equal(store.getState().tasks[0].projectId, null);
  assert.ok(storage.entries().calico_test);
});

test('task validation rejects unsafe scheduling inputs and preserves task fields', () => {
  const storage = memoryStorage();
  const store = domain.createStore({ storage });
  assert.equal(store.createTask({ name: ' ', hours: 1, deadline: '2026-09-25' }).ok, false);
  assert.equal(store.createTask({ name: 'Brief', hours: 0.25, deadline: '2026-09-25' }).ok, false);
  assert.equal(store.createTask({ name: 'Brief', hours: 2, deadline: '2026-09-25', notBefore: '2026-09-26' }).ok, false);
  const task = store.createTask({ name: 'Brief', hours: 2, deadline: '2026-09-25', priority: 'optional', repeat: 'weekly', repeatCount: 3, color: '#007aff' });
  assert.equal(task.ok, true);
  assert.equal(task.value.repeatCount, 3);
  assert.equal(task.value.priority, 'optional');
  assert.equal(task.value.splittable, true);
});

test('damaged local state is recovered without exposing malformed data', () => {
  const storage = memoryStorage({ calico_v02: '{broken' });
  const store = domain.createStore({ storage });
  assert.equal(store.getState().tasks.length, 0);
  assert.match(store.getRecoveryMessage(), /damaged/);
  assert.ok(Object.keys(storage.entries()).some(key => key.startsWith('calico_v02_recovery_')));
  assert.doesNotThrow(() => JSON.parse(storage.entries().calico_v02));
});

test('partial project and task updates preserve the fields not being changed', () => {
  const store = domain.createStore({ storage: memoryStorage() });
  const project = store.createProject({ name: 'Studio', color: '#e67817' }).value;
  const task = store.createTask({ name: 'Brief', hours: 2, deadline: '2026-09-25', projectId: project.id, description: 'Initial scope' }).value;
  assert.equal(store.updateProject(project.id, { name: 'Client work' }).value.color, '#e67817');
  const updated = store.updateTask(task.id, { hours: 3 });
  assert.equal(updated.ok, true);
  assert.equal(updated.value.name, 'Brief');
  assert.equal(updated.value.description, 'Initial scope');
  assert.equal(updated.value.hours, 3);
});

test('event validation rejects invalid scheduling inputs and preserves availability fields', () => {
  assert.equal(domain.validateEvent({ name: 'School run', date: '2026-09-25', start: '09:00', end: '08:00' }).ok, false);
  assert.equal(domain.validateEvent({ name: 'School run', date: '2026-02-30', start: '08:00', end: '09:00' }).ok, false);
  assert.equal(domain.validateEvent({ name: 'School run', date: '2026-09-25', start: '08:00', end: '09:00', repeat: 'custom', repeatDays: [] }).ok, false);
  const event = domain.validateEvent({ name: 'School run', kind: 'availability', date: '2026-09-21', start: '08:00', end: '09:00', repeat: 'weekdays', repeatEndType: 'count', repeatCount: 5 });
  assert.equal(event.ok, true);
  assert.equal(event.value.kind, 'availability');
  assert.equal(event.value.repeatCount, 5);
});

test('event occurrences respect recurrence rules and count limits', () => {
  const weekdays = { id: 'school-run', date: '2026-09-21', start: '08:00', end: '09:00', repeat: 'weekdays', repeatEndType: 'count', repeatCount: 2 };
  assert.equal(domain.eventOccursOn(weekdays, '2026-09-21'), true);
  assert.equal(domain.eventOccursOn(weekdays, '2026-09-22'), true);
  assert.equal(domain.eventOccursOn(weekdays, '2026-09-26'), false);
  assert.equal(domain.eventsOnDate([weekdays], '2026-09-21').length, 1);
  assert.equal(domain.eventsOnDate([weekdays], '2026-09-22').length, 1);
  assert.equal(domain.eventsOnDate([weekdays], '2026-09-23').length, 0);
  const interval = { id: 'focus', date: '2026-09-21', start: '10:00', end: '11:00', repeat: 'interval', repeatInterval: 3 };
  assert.equal(domain.eventOccursOn(interval, '2026-09-24'), true);
  assert.equal(domain.eventOccursOn(interval, '2026-09-25'), false);
});

test('event operations persist, update without losing fields, and delete cleanly', () => {
  const store = domain.createStore({ storage: memoryStorage() });
  const event = store.createEvent({ name: 'Prototype review', date: '2026-09-25', start: '14:00', end: '16:00', color: '#8e68d8' });
  assert.equal(event.ok, true);
  const updated = store.updateEvent(event.value.id, { end: '16:30' });
  assert.equal(updated.ok, true);
  assert.equal(updated.value.name, 'Prototype review');
  assert.equal(updated.value.start, '14:00');
  assert.equal(updated.value.end, '16:30');
  assert.equal(store.deleteEvent(event.value.id).ok, true);
  assert.equal(store.getState().events.length, 0);
});

test('a local persistence failure keeps the in-memory change available', () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  const store = domain.createStore({ storage });
  const result = store.createProject({ name: 'Studio', color: '#e67817' });
  assert.equal(result.ok, true);
  assert.equal(store.getState().projects[0].name, 'Studio');
  assert.match(store.getLastPersistError(), /could not save locally/i);
});
