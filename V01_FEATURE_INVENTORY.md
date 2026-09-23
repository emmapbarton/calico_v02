# Calico v01 Feature Inventory

## Status and Scope

This is the Step 2 inventory required by the v02 build manual. It records
what v01 actually stores, calculates, renders, and tests. It is deliberately
not a v02 parity decision document; that is Step 3's mapping matrix.

**Source inspected:** Calico v01 `main` at `492002a` (`Redesign Calico with
Apple-style planning UI`). The implementation is one browser application:
`index.html`, `style.css`, `app.js`, and an optional Supabase configuration.

**Evidence inspected:**

- `app.js` (5,003 lines): state, persistence, scheduling, UI behaviour.
- `index.html` (799 lines): every current entry point and modal.
- `tests/alpha-smoke.mjs`: 66 deterministic engine and state regression tests.
- `tests/e2e/calico.spec.js`: 8 browser journeys.
- `tests/alpha-results.json`: most recently committed alpha result, 66/66
  passing on 30 August 2026.
- `docs-persistence.md` and
  `supabase/migrations/20260830100853_create_calico_schedules.sql`: account
  boundary and database contract.

**Fresh validation for this inventory:** `npm run check:syntax` passed against
v01, and the unmodified alpha suite was run in an isolated temporary copy to
avoid touching v01's generated artifact: **66/66 passed**.

## 1. Canonical State and Data Contract

All durable product state is one JSON document, `S`, persisted locally under
`calico_v2`. State version 6 is normalised on every load, import, account
restore, and account save. Unknown or malformed parts are either repaired to a
safe default or dropped; the application does not pass unnormalised state to
the scheduler.

```js
{
  stateVersion: 6,
  onboarded: false,
  baseline: 7,                     // integer-ish 1..10
  distribution: 'even',            // even | front | back | weighted
  dayStart: '09:00',
  dayEnd: '18:00',
  maxDailyHours: 8,                // 0.5..24
  weekdayCapacity: {},             // JS weekday 0..6 -> 0..24; legacy/hidden UI
  dailyWorkingHours: {},           // YYYY-MM-DD -> { dayStart, dayEnd, maxDailyHours }
  minBlockHours: 0.5,              // 0.25..24
  splitTasks: true,                // legacy global field; task-level field is authoritative
  taskOverworkAllowances: {},      // taskId|deadline|date -> additional hours
  view: 'week',
  weekOffset: 0,
  dayOffset: 0,
  projects: [],                    // Project[]
  hiddenProjectIds: [],            // Project ids and/or __unassigned__
  tasks: [],                       // Task[]
  events: [],                      // Event[]; includes availability blocks
  intensities: {},                 // YYYY-MM-DD -> value 1..10
  intensityHistory: [],            // last 30 { date, dir: up|down|neutral }
  nudgeDismissed: false,
  taskLog: {},                     // taskId|date -> { scheduled, completed, checked }
  lastCheckinDate: null,
  account: { revision: 0, lastSyncAt: null, lastError: '', email: '' },
  manualOverrides: {}              // occurrenceId -> ManualOverride
}
```

### 1.1 Entity Shapes

```js
// Task: fields present depend on whether it repeats.
{
  id: 'generated-id', type: 'task', name: 'Write launch brief',
  priority: 'mandatory' | 'optional' | 'hard' | 'hard-deadline' |
            'deferred' | 'bumped',
  color: '#RRGGBB', projectId: 'project-id' | null,
  description: 'optional free text',
  deadline: 'YYYY-MM-DD', date: 'YYYY-MM-DD',
  hours: 4, logged: 0,
  dist: 'inherit' | 'even' | 'front' | 'back' | 'weighted',
  minBlockHours: 0.5, splittable: true,
  notBefore: 'YYYY-MM-DD' | null,
  repeat: 'none' | 'daily' | 'weekly' | 'weekdays' | 'weekends' |
          'custom' | 'interval',
  repeatDays: [0..6],              // custom only
  repeatInterval: 7,               // interval only
  repeatEndType: 'date' | 'count',
  repeatEndDate: 'YYYY-MM-DD',     // date end only
  repeatCount: 10                  // count end only
}

// Event. Availability is a first-class kind of event, not a separate entity.
{
  id: 'generated-id', type: 'event', kind: 'event' | 'availability',
  name: 'School run', priority: 'mandatory' | 'optional', color: '#RRGGBB',
  date: 'YYYY-MM-DD', start: '09:00', end: '10:00',
  repeat: 'none' | 'daily' | 'weekly' | 'weekdays' | 'weekends' |
          'custom' | 'interval',
  repeatDays: [0..6], repeatInterval: 7,
  repeatEndType: 'date' | 'count', repeatEndDate: 'YYYY-MM-DD', repeatCount: 10
}

{ id: 'project-id', name: 'Harbour launch', color: '#RRGGBB' }

// Occurrence-specific, so one repeated task occurrence cannot alter another.
{
  pinned: { 'YYYY-MM-DD': 1.5 },
  excludedDates: ['YYYY-MM-DD'],
  timeBlocks: {
    'YYYY-MM-DD': { start: '09:30', end: '11:30', mode: 'preferred' | 'fixed' }
  }
}
```

### 1.2 Normalisation, Migration, and Invariants

- Numeric settings are finite and clamped: baseline `1..10`, daily capacity
  `0.5..24`, minimum block `0.25..24`, week offset `-520..520`, and day offset
  `-3650..3650`.
- A working-hours window must parse and have `end > start`; invalid settings
  fall back to defaults at load and are rejected on form save.
- Every `dailyWorkingHours` key must be ISO date text and every value must be a
  valid window. Invalid entries are removed.
- Projects get unique ids; the reserved `__unassigned__` id cannot be used.
  Names are trimmed and capped at 60 characters. Orphaned task `projectId`s
  become `null`. Hidden filters may only reference a real project or the
  unassigned bucket.
- Event kind normalises to either `event` or `availability`; legacy values
  become `event`.
- Old `pinnedAllocations` migrate only for a non-repeating task, because an old
  task-level key cannot identify a particular repeated occurrence. Legacy
  `dayCapOverrides` is discarded.
- Manual pins, exclusions, and time blocks are sanitised. Invalid time blocks,
  invalid dates, and retired cloud credentials are removed.
- The normaliser is the data compatibility boundary for local storage, import,
  and Supabase. This is a porting-critical contract, not presentation code.

**Tests:** alpha tests cover legacy pin migration, malformed capacity settings,
project migration/orphaning, project metadata preservation, account document
validation, retired cloud credential removal, backup round trips, and working
hours validation. Browser release-gate coverage exercises invalid values.

## 2. Local-First Persistence, Undo, Import, and Recovery

### 2.1 Local Persistence

**Data:** the complete normalised `S` object in `localStorage['calico_v2']`.
`calico_v1` is read only as a migration fallback. The account object stays in
the local document because it is device/session metadata.

**Mechanism:** every mutating UI action calls `save()` after invalidating the
cached plan when scheduling inputs changed. `save()` writes local storage
first, then queues a cloud save only if an authenticated account has completed
its initial load. The UI does not wait for the network to make a local change.

**Outcome and entry points:** there is no explicit Save command. Task/event
save, settings save, drag/drop, intensity sliders, check-in, project changes,
and reset persist immediately. Reload restores the schedule.

**Edge cases:**

- A local storage exception logs an error and shows “Export a backup before
  closing”; it does not falsely claim success.
- Invalid JSON is copied to a timestamped `calico_recovery_*` local-storage
  key when possible, then the app opens a clean normalised state and shows a
  recovery toast.
- Navigation state is persisted, but the engine cache key excludes it, so
  changing a view cannot change allocations.

**Tests:** E2E onboarding/task/reload persistence; alpha stress 18 backup
round-trip and stress 19 render/navigation allocation invariance.

### 2.2 Undo

**Data:** an in-memory `_undoStack`, maximum 10 cloned complete states. It is
not persisted and therefore does not survive reload.

**Mechanism:** selected mutating operations call `snapshotForUndo(label)` before
changing state. Undo pops one snapshot, normalises it, invalidates the plan,
saves locally, rerenders, and updates the disabled/title state of the top-bar
Undo button.

**Entry point/outcome:** top-bar Undo or `Ctrl/Cmd+Z` restores the prior state
and shows “Undid [label]”. Included callers cover manual constraints, working
hours, projects, deletes, reset, and import; ordinary add/edit task/event saves
do not consistently snapshot first.

**Edge cases:** the stack silently drops its oldest state above ten; no redo;
browser-native undo is suppressed outside form controls.

**Tests:** no dedicated E2E test. State-level mutation safety is extensively
covered by the alpha regression suite, but undo stack UI/history is a coverage
gap.

### 2.3 Backup and Restore

**Data:** export serialises `{ exportedAt, state }`, where state is a deep clone
with `account` and retired `cloud` data removed. Import accepts that envelope or
the raw state document.

**Mechanism:** import requires an object containing `tasks` and `events`, asks
for browser confirmation, snapshots for Undo, normalises, invalidates the
plan, saves, and rerenders. It then becomes the next eligible account update.

**Entry points/outcome:** Settings > Export backup downloads
`calico-backup-YYYY-MM-DD.json`; Settings > Import backup opens a JSON file
picker. Successful import says “Backup imported”.

**Edge cases:** cancelled selection is a no-op; malformed JSON, invalid schema,
or rejected confirmation leave current data intact and show an error; account
metadata and credentials never enter export data.

**Tests:** E2E export download; alpha stress 18 complex repeated backup/restore;
alpha release-gate backup stripping; browser release-gate backup inspection.

## 3. Account Sync With Supabase Email Magic Links

**Data:** local `account` metadata is `{ revision, lastSyncAt, lastError,
email }`; it is explicitly removed from `stateForAccountSync()`. Remote data is
one row per authenticated user: `user_id`, `state jsonb`, `revision bigint`,
timestamps.

**Mechanism:**

1. The client is optional: it activates only when a publishable URL/key and
   `supabase.createClient` exist.
2. It creates a Supabase auth client with persisted, auto-refreshed sessions
   and URL magic-link detection.
3. Email entry calls `signInWithOtp`, redirecting back to the current origin.
4. On first authenticated session it calls `get_calico_schedule()`.
5. No remote row: current local schedule is queued for upload. A remote row:
   use remote if the device has no schedule, otherwise the person chooses
   account copy or device copy via a browser confirm.
6. Mutations debounce `save_calico_schedule(expected_revision, next_state)` by
   600ms. The RPC atomically creates revision 1 if expected revision is 0 or
   updates only when the supplied revision matches, incrementing it.

**Outcome and entry points:** Settings > Account & sync displays email sign-in,
signed-in email, Sync now, Sign out, and a textual sync status. This is
email-only; Google sign-in is not implemented.

**Edge cases:**

- Missing client configuration means sign-in controls are unavailable rather
  than silently broken.
- Network/auth/RPC failure keeps the local schedule untouched and reports the
  error.
- A malformed remote document is rejected without replacing local state.
- A revision mismatch returns no row. Sync pauses with “Another device changed
  this schedule”; it never uses last-write-wins and v01 has no screen to merge
  versions.
- Sign out clears local session metadata but deliberately leaves local planning
  data intact.
- RLS policies permit only a user’s own `calico_schedules` row. Browser code
  contains no service-role key.

**Tests:** E2E magic-link/RPC payload, remote invalid-state safety, and account
configuration/UI path. Alpha verifies sync payload stripping and account-load
document validation. There is no live Supabase integration test, no actual
email delivery test, and no multi-device revision-conflict browser test.

## 4. Capacity, Intensity, and Working Hours

### 4.1 Baseline Intensity

**Data:** `baseline` is a `1..10` value; `intensities[date]` stores an explicit
day value. Unspecified dates inherit baseline. `intensityHistory` stores the
last 30 directions relative to baseline.

**Mechanism:** a day’s raw task capacity is
`min(workingWindowHours, configuredMaxTaskHours) * (dayIntensity / baseline)`;
it is rounded to two decimal places and capped at 24. A baseline of 7 with a
day intensity of 5 therefore reduces capacity to roughly 71%; an intensity of
9 increases it to roughly 129%, still subject to the physical/day-window cap.
Events/availability are subtracted after this calculation.

**User-visible controls:**

- Onboarding Step 2 has a `1..10` range slider, a live numeric value, an
  intensity description, and a CSS `--pct` fill that tracks the thumb.
- Settings > Baseline intensity repeats the slider and description, then Save
  baseline.
- Week and Agenda render one compact `1..10` slider per date. Its displayed
  number updates live; `setInt()` immediately saves and recalculates.
- Past sliders are disabled and labelled historical. Today and future remain
  editable.

**Outcome:** lower intensity makes less task work schedulable; higher intensity
makes more schedulable within the configured day. Changing baseline clears the
direction history and re-enables the nudge, then revalidates affected tasks.

**Edge cases:** a malformed saved value is clamped; intensity higher than
baseline intentionally increases capacity; intensity changes may create or
resolve conflicts; past values are visible but cannot be edited from the UI.

**Tests:** alpha covers historical-vs-editable dates and the conflict-resolution
intensity proposal. Capacity, determinism, and revalidation are covered by the
general engine suite. There is no pixel/slider accessibility test.

### 4.2 Baseline Nudge

**Data:** `intensityHistory` and `nudgeDismissed`.

**Mechanism:** after each day-intensity change, the last three consecutive
history entries are inspected. If all are `up` or all are `down`, the nudge
appears. Saving a new baseline clears history and undismisses it; dismissing
persists the choice.

**Entry/outcome:** fixed toast-like nudge says the person has shifted
intensity the same way for three days, with Reassess (Settings) or close.

**Edge cases:** neutral changes interrupt the pattern; entries are updated when
the same latest date changes again; history is capped at 30. The condition is
based on edits, not necessarily consecutive calendar dates.

**Tests:** no dedicated test; this is a coverage gap.

### 4.3 Default, Weekday, and Per-Day Working Hours

**Data:** global `dayStart`, `dayEnd`, `maxDailyHours`, and `minBlockHours`;
compatibility `weekdayCapacity[0..6]`; per-date
`dailyWorkingHours[date] = { dayStart, dayEnd, maxDailyHours }`.

**Mechanism:** `workingHoursForDay(date)` chooses the date override first,
otherwise defaults. A date override wins over a weekday capacity. Capacity is
capped both by max task hours and by the duration of the working window.
Changing any of these invalidates the plan and revalidates existing tasks.

**Entry points/outcomes:**

- Settings > Working hours: default start, end, daily maximum, and minimum
  block; Save hours.
- Day view > Working hours: opens a date-specific editor with start, end, and
  max task hours; can return the date to defaults.
- Week timeline visually marks each day’s working window; Day shows capacity
  after events.

**Edge cases:** end must be later than start; capacity and minimum block are
clamped; daily override persists even if later capacity becomes inadequate;
removing an override restores defaults and triggers revalidation. The
`weekdayCapacity` data is honoured but has no current visible settings editor.

**Tests:** alpha validates weekday capacity, working-window cap, daily override
precedence, malformed normalisation, and release-gate validation; E2E saves and
persists a per-day override.

## 5. Canonical Scheduling Engine

This is v01’s central proven mechanism. All Week, Day, Agenda, Review,
conflict checks, drag/drop, and timeline rendering read `allocateSchedule()`;
they do not each schedule independently.

### 5.1 Inputs and Output

**Inputs:** tasks, events, intensity/baseline, working settings, task-scoped
overwork, manual overrides, task log, and global distribution. The plan cache
key includes all allocation inputs and deliberately excludes view/filter state.

**Output:**

```js
{
  allocations: { taskId: { 'YYYY-MM-DD': hours } },
  occurrenceAllocations: { occurrenceId: { date: hours } },
  occurrenceResults: { occurrenceId: { allocated, shortfall, fullyAllocated } },
  occurrences: [Occurrence],
  conflicts: { taskId: Conflict },       // task aggregate for current UI
  conflictsByTask: { taskId: Conflict },
  conflictSummary: { hard: [Conflict], soft: [Conflict] },
  affectedTasks: [taskId],
  dailyCapacity: { date: hours },        // before events
  dailyFree: { date: hours },            // after events/availability
  dailyUsed: { date: hours },
  dailyEvents: { date: Event[] },
  window: { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
}
```

### 5.2 Calculation Sequence

1. **Date window:** starts today, normally extends 180 days, extends to a
   farther task deadline/repeat end where needed, and is hard-capped one year
   from today.
2. **Capacity:** calculate raw capacity per date from working settings and
   intensity, then subtract every event occurrence, including availability.
3. **Task occurrence expansion:** turn one-off tasks into one occurrence and
   repeated tasks into independent `taskId|occ|date` occurrences. Every
   occurrence has a window start, deadline, demand, priority, distribution,
   split rule, minimum block, recurrence rule, and occurrence-specific manual
   overrides.
4. **Carry-forward:** for past logged dates, add
   `max(scheduled - completed, 0)` to future work. A current/future unchecked
   task is never treated as missed, preventing accidental demand inflation.
5. **Priority order:** rank hard/hard-deadline first, mandatory second,
   optional third, deferred/bumped fourth. Within a rank: earlier deadline,
   then higher hours-per-eligible-day urgency, then stable occurrence id.
6. **Equal-priority fairness:** items in the same priority/deadline wave are
   allocated as a batch. Under constrained capacity they receive proportional
   demand quotas instead of whichever item happened to be iterated first.
7. **Manual constraints first:** pinned daily hours, exclusions, and timed
   blocks claim their occurrence capacity before automatic allocation.
8. **Automatic allocation:** choose eligible dates after today/not-before,
   before deadline, matching recurrence restrictions, with at least the
   minimum block free. Allocate according to selected distribution while
   enforcing minimum block chunks. Non-splittable work needs one whole
   qualifying day.
9. **Task-scoped overwork:** explicitly approved extra hours may be consumed
   only by that task occurrence/date. It never raises generic capacity for
   other tasks.
10. **Conflict construction:** any shortfall above 0.05 hours becomes a hard or
    soft conflict with a reason: user constraints, event-blocked,
    accepted-shortfall, displaced-by-higher-priority, or insufficient-capacity.

### 5.3 Distribution Rules

**Data:** task `dist`; `inherit` means global `distribution`.

- `even`: equal weights across eligible days.
- `front`: descending weights from earliest eligible day to deadline.
- `back`: ascending weights, deliberately favouring the deadline.
- `weighted`: weights equal current free capacity, deliberately favouring
  lighter days.

The engine limits number of chosen days to the number of meaningful minimum
blocks and removes a candidate whose proportional share would be too small.
This avoids a 30-minute task being scattered across many tiny slivers.

**Tests:** alpha explicitly proves front/back/free-time direction, min-block
enforcement, non-splittable behaviour, constrained batch safety, priority
cascade, deterministic 150-task/50-event load, and many conservation tests.

### 5.4 Important Scheduler Edge Cases

- Past one-off task deadlines are not scheduled.
- Repeating task windows are bounded by the prior occurrence. Weekday,
  weekend, and custom repeat patterns cannot spill onto non-matching days;
  daily/weekly may use the full inter-occurrence window.
- Repeated tasks receive occurrence-specific overrides so changing Tuesday’s
  occurrence does not affect the following Tuesday.
- A pinned day’s requested amount is excluded from later automatic allocation
  even when the calendar cannot supply it; the unrealisable amount remains a
  visible shortfall rather than being silently moved.
- A skipped deadline day is fixed at zero and remains visibly short; a skipped
  earlier day reallocates later eligible capacity when available.
- A non-splittable item receives no partial allocation when no single eligible
  day can hold the remainder.
- Existing automatic target hours are included when a drag pins a target; this
  prevents a drag from discarding work that was already scheduled there.
- Timed fixed blocks reserve only their duration; any remaining task demand on
  that date may still be automatically allocated.

**Tests:** all 20 alpha stress tests, plus the targeted tests named in sections
6–10, exist specifically to protect these cases.

## 6. Tasks: Create, Read, Edit, Delete, and Detail

**Data:** `Task` from Section 1.1, assigned project and colour, plus optional
manual overrides/task-log state held separately.

**Entry points:** sidebar Add task, desktop/mobile add controls, keyboard `N`,
task blocks/rows (open details), Details > Edit task, and Delete from edit.

**Mechanism:** task form save requires non-empty name and at least 0.5 expected
hours. It builds the task object, then runs a hypothetical allocation before
committing a mandatory/hard task. If it would create a hard conflict, the form
closes into conflict resolution. Ordinary task edits preserve valid manual
overrides; overrides whose recurrence occurrence no longer exists are removed.
Editing a task also clears stale task-scoped overwork allowances. A task cannot
reduce its estimate below hours already fixed in one occurrence.

**User-visible outcome:**

- The basic form exposes name, task/event type, mandatory/optional priority,
  deadline, expected hours, and colour.
- Advanced task options expose recurrence, repeat ends, min block, not-before,
  project, description, and split-across-days checkbox.
- Task detail shows priority symbol/label, description, deadline, expected
  hours, and an Edit task action.
- Delete asks for confirmation and deletes all task schedule blocks and manual
  overrides. The confirmation says completed history stays, but the code does
  not remove matching `taskLog` entries, so that history is indeed retained.

**Edge cases:** name missing focuses the input; advanced section is collapsed
for a new task and opened for edit; repeated task’s visible deadline label
becomes First occurrence; recurrence anchor aligns `date` and `deadline`;
invalid fixed-time totals prevent an edit; user-entered name/description is
escaped on render.

**Tests:** E2E creates, reloads, edits, displays details, tests advanced
options, rejects zero hours, and checks deletion indirectly through lifecycle
flows. Alpha tests user-string escaping, edit/constraint preservation, and
fixed-hour checks.

## 7. Recurring Tasks

**Data:** task recurrence fields in Section 1.1; each expansion produces a
separate occurrence id and separate `manualOverrides[occurrenceId]`.

**Mechanism:** patterns supported are daily, weekly (same weekday as start),
weekdays, weekends, arbitrary selected weekdays, and every N days. Repetition
ends on a date or after a count. The start/first occurrence date always counts.
The engine expands through its date window and schedules only current/future
occurrences.

**Outcome/entry:** Task > Advanced options > Repeat, start date, day chips or
interval, and end rule. Sidebar/task display shows a recurrence label.

**Edge cases:** repeat count is enforced while iterating; a custom list is
stored as JavaScript weekday numbers (Sunday 0); recurrence changes discard only
override ids no longer generated; task logs from a repeated task attach by task
and date, while overrides attach by occurrence.

**Tests:** alpha proves override isolation, drag isolation, current-day log
non-inflation, and recurrence interactions. Browser E2E has no dedicated
repeated-task form journey; that is a coverage gap.

## 8. Events and Availability Blocks

**Data:** an `Event`, with `kind: 'event'` for a commitment and
`kind: 'availability'` for time Calico must leave free.

**Mechanism:** events use the same recurrence patterns/end rules as recurring
events. Every occurrence subtracts `end - start` from daily free capacity. The
scheduler treats availability exactly like an event for capacity and collisions,
while renderers label it differently.

**Entry points/outcome:** sidebar Add event; sidebar/Week Reserve time opens
the event form with `availability` preselected; click event blocks/strips to
edit. Week and Day label blocks Event/Fixed event or Availability/Availability
block; calendars prevent fixed task-time overlap with either.

**Edge cases:** end must be later than start; start date is always an occurrence;
count end is computed by counting earlier valid occurrences; editing or deleting
a repeating event immediately invalidates and revalidates every affected day;
event priority is stored but does not influence capacity subtraction.

**Tests:** E2E event add/edit/display, recurring event, daily/recurring
availability, and persistence. Alpha stress 17 repeat-event CRUD/revalidation,
preferred-time yielding to availability, and fixed-time collision behaviour.

## 9. Day-Level Task Hours, Drag/Drop, Skip, and Automatic Return

### 9.1 Adjust Daily Task Hours

**Data:** `manualOverrides[occurrenceId].pinned[date] = hours`, or an excluded
date for zero hours. A day-level adjustment removes any time block for that
date because the day lock becomes the authoritative instruction.

**Mechanism:** the editor resolves the specific occurrence, calculates already
fixed hours on other dates, and caps the value at `occurrence.hours - other
fixed hours`. Saving a positive amount pins that date; saving zero excludes it.
The engine locks it, redistributes remaining hours to automatic eligible dates,
and preserves a resulting shortfall rather than overriding the person’s choice.

**Entry/outcome:** Week task block `±`, Day task action Adjust, Agenda task
action Adjust. The modal has +/- 30-minute steps, direct numeric input, an
explanation of reduction/increase consequences, other fixed-day release
controls, Use automatic hours, and Release all fixed days.

**Edge cases:** decreasing redistributes only to future eligible automatic
dates; increasing pulls from the same occurrence’s automatic days without
changing total demand; more than remaining unfixed demand is rejected; an
impossible lock stays saved and shows a shortfall warning; a repeating
occurrence adjustment does not bleed to another occurrence.

**Tests:** alpha targeted daily reduction/increase/impossible lock/release/edit
preservation plus stress 1–3, 5, 13; E2E manual adjustment and browser release
gate flows.

### 9.2 Drag to Reschedule

**Data:** source date becomes excluded if it was automatic; target date becomes
pinned to its prior allocation plus moved full-day allocation. This is stored
in the occurrence override.

**Mechanism:** Week blocks and non-past Agenda rows are draggable. A visual
chunk may be a fragment around an event, but drag records the occurrence’s full
date allocation so a split visual block moves only once. Target validation
requires today-or-later, after not-before/window start, on/before deadline, and
compatible recurrence weekday. The resulting manual constraint is authoritative
even if it creates a shortfall.

**Outcome:** valid drop says “Moved to [date]”; constraint warning or shortfall
toast appears if the move cannot fully fit. The block becomes user-fixed.

**Edge cases:** drop on original date does nothing; malformed/missing occurrence
is rejected; cannot drag before today/not-before, after deadline, or onto a
non-recurrence date; occupied target retains user choice and reports shortfall;
repeated drags conserve requested total.

**Tests:** alpha stress 1–5 and 13, including visual split allocation and
weekday constraints. There is no browser drag-and-drop E2E test.

### 9.3 Skip and Return to Automatic

**Data:** skip is the same zero-hour exclusion constraint; restoring removes
the date pin/exclusion/time block and cleans empty overrides.

**Entry/outcome:** Week block arrow and Agenda Skip →. Agenda shows Auto when a
manual override exists. Skip says reallocated before deadline when it fits;
otherwise it explicitly says the remaining shortfall cannot fit.

**Edge cases:** a deadline-day skip is not undone by the engine; it remains zero
and produces a visible shortfall. Repeated skip does not duplicate demand.

**Tests:** alpha skip targeted tests and stress 6–8; manual return covered by
targeted test and E2E adjustment journey.

## 10. Time-Aware Task Blocks: Flexible, Preferred, and Fixed

**Data:** `manualOverrides[occurrenceId].timeBlocks[date]` stores `start`,
`end`, and `mode`. Adding a timed block does not need to pin the whole day.

**Mechanism:**

- `fixed`: valid only inside working hours, within the occurrence’s remaining
  unpinned demand, and non-overlapping with events/availability or another
  fixed task. It reserves its exact duration and automatic work goes around it.
- `preferred`: valid working-window and duration only. It is placed at that
  exact position if free; an event or fixed task wins the collision and the
  task becomes flexible for presentation on that date.
- `flexible`: no saved time block. The day timeline places it in the first
  free working-hours slot after events/fixed/preferred claims; if fragmented,
  it may use sequential gaps down to the global minimum block.

**Entry/outcome:** Week block clock action and Day task Time action open Set
time. The person chooses Prefer this time or Keep this time fixed, start/end,
then Save time; Use flexible timing removes the override. Week/Day labels say
preferred, fixed, adjusted, or flexible as appropriate.

**Edge cases:** an invalid range, outside-window time, excessive duration, event
overlap, or fixed-task overlap is rejected before save; preferred is not an
overlap error because it is allowed to yield; one fixed duration can coexist
with automatic remainder for the same occurrence; fixed mode only validates
against *other* fixed blocks and events, not the automatic timeline.

**Tests:** alpha fixed-time preservation/automatic avoidance and preferred-time
yielding to recurring availability; E2E fixed time plus per-day working hours
and reload persistence. There is no dedicated fixed-task-vs-fixed-task E2E.

## 11. Completion, Partial Completion, Skipped Work, and Daily Check-In

### 11.1 Inline Completion

**Data:** `taskLog['taskId|date'] = { scheduled, completed, checked }`.

**Mechanism:** marking done records completed equal to scheduled. Undoing done
on today/future deletes the log entry, returning to neutral; undoing a past
completion records zero complete, intentionally creating carry-forward demand.
Partial completion clamps `0..scheduled`; any remaining past hours are added
once to future occurrence demand.

**Entry/outcome:** Week task block circle/check, Day Done and Partial actions,
Agenda circle/check. Done renders a completed state; partial editor says the
remaining amount will be replanned.

**Edge cases:** completion cannot exceed scheduled; toggling an unchecked
current/future item cannot inflate a repeated occurrence; repeatedly cycling
done/not-done cannot create extra demand; repeated task completion applies to
the one dated occurrence only.

**Tests:** alpha completion action parity, week render, partial carry-forward,
and stress 9–12; E2E Day Done/Partial interaction.

### 11.2 Daily Check-In

**Data:** same task log plus `lastCheckinDate`.

**Mechanism:** on application boot it inspects yesterday’s scheduled task work.
Any row with no log, an unchecked log, or completed hours below scheduled is
included. The modal defaults each task to recorded completion or zero, writes
all rows on submission, sets `lastCheckinDate` to today, invalidates/replans,
and explains that unfinished work returned to the schedule.

**Entry/outcome:** automatic first-load prompt. Per row: checkbox, Done, Partly,
Skipped, and a 0.25-hour completed input. Remind later hides without setting
lastCheckinDate; close/dismiss marks the prompt seen today without changing
task logs.

**Edge cases:** no prompt when none scheduled; fully completed row is prechecked;
partial default is half the scheduled work when no partial record exists; only
yesterday is considered; dismiss means no same-day repeat prompt, remind later
does repeat on next load.

**Tests:** E2E partial check-in UI; alpha verifies submit records UI partial
hours and the carry-forward/non-duplication cases. No E2E test distinguishes
dismiss from Remind later.

## 12. Scheduling Conflicts and Review

### 12.1 Hard Versus Soft Conflicts

**Data:** scheduler `conflictSummary` and task-aggregated conflict records.
Hard rank is priority hard/hard-deadline/mandatory; optional is soft;
deferred/bumped means accepted shortfall.

**Mechanism/outcome:** a new/edit mandatory task runs a hypothetical schedule.
Hard shortfall opens the conflict dialog before commit. Existing schedule
changes revalidate: hard conflict opens the dialog for the affected task;
soft displacement produces a non-blocking toast and appears in Review.

**Entry points:** conflict after Task Save or revalidation; Sidebar Needs
review; Review navigation/page.

### 12.2 Conflict Resolution Choices

All proposals first simulate a cloned state. Except “Save anyway”, the dialog
will not commit if the proposal leaves the task short or creates any hard
conflict elsewhere. A failed proposal restores exact previous state/cache.

1. **Extend deadline:** choose/suggest the earliest date through the next 365
   days that fits the full estimate.
2. **Reduce estimate:** binary-search the largest 0.5-hour estimate that fits.
3. **Add overwork:** select dates and extra daily hours. Stored per task,
   occurrence deadline, and date; never grants extra capacity to other tasks.
4. **Make this task optional:** accepts a soft shortfall instead of displacing
   mandatory work.
5. **Demote other mandatory tasks:** select other mandatory tasks, changing
   them to optional to free capacity.
6. **Raise low day intensity:** change only days below baseline, up to 10.
7. **Save anyway:** marks this task deferred and retains a visible unresolved
   shortfall.

**User-visible outcome:** modal reports estimated/available/short hours,
earliest deadline suggestion, live fit badges, selected option badges, and
explicitly allows discarding an uncommitted task. Review lists soft conflicts,
with a summary and a resolution path that turns the task mandatory then opens
the same conflict mechanism.

**Edge cases:** all days event-blocked is explained; no viable reduction
disables that choice; a reduced estimate cannot fall below existing fixed hours;
editing a task clears obsolete overwork allowances; unresolved deferred work is
kept visible rather than silently disappearing.

**Tests:** E2E conflict modal; alpha priority cascade, conflict proposal
immutability, overwork lifecycle, reduction boundary, constrained batch,
soft/hard summary, and stress 14–16. There is no E2E journey for every one of
the seven options.

## 13. Project Management and Filters

**Data:** `projects`, task `projectId`, and `hiddenProjectIds`.

**Mechanism:** projects are metadata only. The scheduler never filters or
reallocates on project visibility. Deleting a project removes its metadata,
unassigns its tasks, clears its filter id, and leaves schedule/demand intact.

**Entry/outcome:** Settings > Manage projects; create using name/colour; edit
name/colour inline; delete with confirmation. Week filter bar toggles projects
and has Show all. Sidebar groups visible tasks by project plus No project.

**Edge cases:** blank names rejected; names max 60; no-project is a synthetic
reserved bucket, not a persistent Project; a hidden project can hide tasks
from Week/Agenda/Sidebar but not calculate them away.

**Tests:** alpha defensive migration/orphaning, filter allocation invariance,
metadata backup normalisation; E2E search/project coverage indirectly. There
is no dedicated browser project CRUD test.

## 14. Views, Calendar Geometry, Search, and Navigation

### 14.1 Week, Day, and Agenda

**Data/mechanism:** all three views read the same canonical plan and
`buildDayTimeline()`. Week renders a scrollable full 24-hour grid with actual
working window shading, event/availability blocks at absolute times, task
blocks at timeline times, day intensity sliders, project filtering, and drag
targets. Day renders date navigation, working-hours control, task/free capacity
stats, event cards, and task actions. Agenda renders seven date groups,
intensity/load/capacity, event strips, task actions, and drag targets.

**Entry/outcome:** sidebar, desktop segmented Day/Week/Agenda controls, mobile
nav, previous/next, Today. `shiftWeek()` changes day offset only while in Day;
otherwise changes week offset. `goToday()` resets both.

**Edge cases:** Week starts Monday; today is highlighted; weekends render; past
Agenda task actions/drag are disabled; empty day says nothing scheduled;
calendar rendering escapes labels and does not own scheduling state.

**Tests:** E2E desktop/mobile smoke, Day task action layout, availability
rendering. Alpha asserts render/navigation cannot alter allocations and Day
items cover tasks/events/projects.

### 14.2 Search

**Data:** no separate index; it scans current tasks, events, projects, task
description, deadline, priority, and project name.

**Mechanism:** case-insensitive substring match, capped at eight results.
Task hit opens task detail; event opens event edit; project opens Settings then
scrolls project management into view.

**Entry/outcome:** top-bar search; it shows No matches only after non-empty
query; clicking outside, changing view, Escape, or opening a hit closes it.

**Edge cases:** empty query returns no rows and hides popup; labels/meta are
escaped; search does not mutate plan state.

**Tests:** E2E search task; alpha UX test covers task/event/project results.

### 14.3 Keyboard and Modal Behaviour

**Entry points:** `N` add task, `E` add event, `T` Today/Day, `Ctrl/Cmd+Z`
Undo; Escape closes every modal/check-in/search. Backdrop clicks close relevant
modal, and generic destructive confirmation wraps delete/reset actions.

**Edge cases:** shortcuts do not run while typing into input/textarea/select or
contenteditable; modal close does not roll back already saved state.

**Tests:** no dedicated keyboard or focus-management test. E2E uses accessible
roles for many controls, but full keyboard navigation/accessibility coverage is
missing.

## 15. Settings and Data Reset

**Features/entry points:** Settings contains baseline intensity, distribution,
working hours/minimum block, reset, account/sync, backup/restore, and project
management.

**Reset data mechanism:** confirmation then clears tasks, events, projects,
filters, intensity history, per-day hours, task logs, manual overrides, and
overwork allowances. It retains global settings and account connection.

**Edge cases:** reset is undo-snapshotted; backup/import prompt uses browser
confirm rather than custom product UI; task count/project filter state recovers
through normalisation.

**Tests:** E2E export/reset/restore lifecycle broadly; no dedicated assertion
that every reset field is removed or that account is retained.

## 16. Rendering and Security Guarantees

- User text is rendered via `escapeHtml` where string HTML is used; project
  colours are validated `#RRGGBB` before they become inline CSS.
- Rendering uses a cached canonical plan and does not mutate scheduling inputs.
- Dynamic filter and navigation state are not allocation inputs.
- Task/event UI distinguishes availability, event, optional task, completed
  task, fixed/preferred/flexible time, and manually adjusted work.

**Tests:** alpha user-entered HTML escaping, project filter plan invariance, and
navigation/render invariance. There is no security scan, CSP, or accessibility
audit in v01.

## 17. Test Coverage Inventory and Limits

### Verified Existing Suites

- **Alpha smoke:** 66/66 committed passing results, freshly rerun for this
  inventory in an isolated copy. It executes `app.js` in a controlled VM with
  fixed dates and interaction stubs. Its strongest coverage is allocation
  conservation, recurrence isolation, constraints, conflict proposals, state
  normalisation, backups, and deterministic scale.
- **Playwright E2E:** 8 browser journeys: onboarding/persistence/mobile;
  event/backup/search/manual adjustment; recurring event/conflict/check-in;
  task form/details/partial completion; availability/daily hours/fixed time;
  account magic-link payload; invalid remote data safety; release-gate inputs
  and backups.

### Material Coverage Gaps To Carry Into v02 Planning

#### G1. No Live Supabase, Email, or Multi-Device Integration Test

The existing account E2E test supplies a JavaScript imitation of Supabase. It
proves that the browser *asks* for a magic link, calls the intended RPC names,
and omits account metadata from the outgoing JSON. It does **not** prove that
Supabase Auth sends or accepts a magic link, that the SQL functions work under
real Row Level Security, or that a deployed browser receives a usable session
after returning from email.

It also cannot prove the most important multi-device scenario. In v01 this is:

1. Device A and Device B both restore revision 7 of the same schedule.
2. Device A changes a task and saves revision 8.
3. Device B changes something from its stale revision 7.
4. The server returns no updated row to Device B.
5. Device B keeps its local state, records a sync error, and stops automatic
   sync rather than overwriting A's revision 8.

There is similarly no test of the account-choice branch when a signed-in device
already has local planning data and the account also has a schedule. v01 uses a
browser confirm for that choice; the application must not accidentally upload
the local copy before the person has chosen.

**v02 requirement when hosting/auth is linked:** use a non-production Supabase
project or isolated test accounts; exercise a real magic-link callback (or
Supabase-supported test equivalent), RLS isolation between two users, first
upload, remote restore, local-versus-remote choice, stale revision, network
failure, sign-out, and account payload privacy. This is not a reason to weaken
the local-first rule while auth is deferred; it is a required test slice once
auth is ported.

#### G2. Important Interactions Lack Browser-Level Tests

The alpha suite proves most underlying state transitions, but the following
user journeys are not driven through real browser controls:

- **Drag/drop:** source and target dates, visual fragments around events,
  rejected targets, recurrence-restricted targets, and a resulting constraint
  warning. The alpha test calls the same state logic but does not prove that a
  person can successfully pick up and drop the actual v02 block.
- **Keyboard controls:** `N`, `E`, `T`, `Escape`, and `Cmd/Ctrl+Z`, including
  the requirement that shortcuts do nothing while typing in a form field.
- **Undo:** the browser's label, enabled state, the ten-item limit, and the
  fact that undo rerenders the same schedule a prior action produced.
- **Project CRUD:** add, rename, recolour, delete, unassign tasks on delete,
  filter/hide a project, and prove that filtering has no scheduling side
  effect.
- **Repeated tasks:** form configuration for each repeat rule, date/count end,
  generated occurrences, editing a recurrence, and isolation of an override on
  one occurrence.
- **Conflict choices:** v01 has seven materially different resolution paths.
  The current E2E only proves a conflict appears; it does not prove each choice
  has the stated outcome or that an invalid proposal leaves state unchanged.
- **Timed-block collision:** preferred time yielding to an event, fixed time
  rejection against an event or fixed task, return to flexible timing, and
  timeline rendering around the resulting blocks.

**v02 requirement:** do not build one giant test later. Add the E2E journey in
the same slice that ports its mechanism. For example, the task-time slice gets
fixed/preferred/collision tests; the manual-allocation slice gets drag/skip/
adjust/return-to-auto tests. The matching alpha engine tests remain the faster
regression layer underneath.

#### G3. No Automated Visual-Regression Baseline

The approved v02 shell was manually visually QA'd, which is the correct first
gate and is sufficient for Step 1. v01 has no screenshot/pixel comparison that
would notice an unintended change to desktop geometry, spacing, typography,
block treatment, modal positioning, or the subtle distinction between task and
event borders.

**v02 requirement:** once a ported surface is stable, capture deterministic
desktop screenshots at the agreed reference viewport using fixed fixture data,
fixed date/time, and a stable font/runtime. Compare Week, Today, Agenda,
Review, Settings, task detail, New task, Reserve time, Working hours, task
hours, and conflict/review overlays to approved baseline images. Dynamic text,
timestamps, or remote status must be fixed or masked deliberately; they must
not create noisy snapshots. Screenshot failure should trigger visual review,
not automatic acceptance of an approximate replacement.

This test category verifies visual output, not scheduling correctness. It must
sit alongside, rather than replace, the engine and interaction tests.

#### G4. Accessibility, Performance, and Browser Support Are Unproven

v01 has some accessible labels and role-based E2E selectors, but it does not
prove a complete accessible application. In particular, its modal overlays do
not have tested focus trapping, focus restoration to the invoking control,
semantic announcements for conflicts/toasts, or fully keyboard-operable drag/
drop alternatives. Its colour states have not been contrast audited. Mobile
exists in v01 but is not the current v02 design priority.

There is also no measured scheduling performance budget. The alpha stress test
shows that 150 tasks and 50 repeating events remain finite and deterministic;
it does not measure browser render time, input latency, memory, or sync timing.
Nor is there a browser compatibility matrix.

**v02 requirement:** before a public release, run automated accessibility
checks plus manual keyboard and screen-reader passes; define a keyboard path
for every task action and drag equivalent; establish supported browser versions
and test them; and measure a representative large schedule in a real browser.
These are release-quality gates, not a request to add mobile polish before the
desktop design is ready.

#### G5. The Alpha Suite Cannot Test the DOM Contract

The alpha tests execute `app.js` in a VM with minimal interaction stubs. That
is why they are so valuable for pure logic: they are fast, deterministic, and
not vulnerable to layout timing. The cost is that they cannot prove:

- a DOM selector exists and is connected to the correct handler;
- an overlay preserves the background view rather than blanking it;
- focus, click targets, and event propagation work as intended;
- controls fit, align, and remain readable at the desktop viewport;
- the week grid, time geometry, border treatment, overflow, or z-index is
  correct; or
- a CSS change has not made a core task interaction unreachable.

**v02 requirement:** preserve the alpha-like unit/engine layer for invariants,
then add browser interaction tests and visual snapshots for the DOM contract.
Treat a passing alpha suite as evidence that the calculation is sound, never as
evidence that the product surface is complete.

## 18. Porting-Critical Invariants for the Step 3 Matrix

These are not parity decisions. They are v01 behaviours the matrix must
explicitly preserve, defer, migrate, or intentionally retire.

### I1. One Canonical Allocation Result

`allocateSchedule()` is v01's single allocator. It consumes state and returns
the entire plan: task/occurrence allocations, capacity, used/free hours,
events, and conflict summaries. Week, Today, Agenda, Review, conflict
simulation, drag/drop, and timeline geometry are all views of that result.

**Why this matters:** if v02 gives each screen a small local allocator, screens
can disagree about which hours are planned, a manual edit in Today can be lost
in Week, and conflicts can be reported against a different schedule from the
one rendered. This is a classic source of patches-over-patches.

**Step 3 implication:** every v01 scheduling feature must map either to inputs
of the v02 canonical allocator, fields of its plan output, or a presentation
that only reads that plan. A visual component may never silently manufacture
its own allocation.

### I2. Local-First Is a Data-Safety Rule

The successful local mutation is the source of immediate user feedback. It is
written to local storage before cloud work is queued. Sync is an additional
durability layer, not permission for the UI to show a change. A network,
authentication, RPC, or conflict error leaves local planning data present and
readable.

**Why this matters:** replacing this with “wait for server, then update the
calendar” would make Calico unusable offline and risks data appearing to vanish
when a request fails. Replacing it with uncontrolled background retries risks
overwriting another device.

**Step 3 implication:** any v02 persistence abstraction must define a local
commit path and a distinct sync-status/error path. The mapping row for every
stateful feature should name whether its change is local-only today, syncable
later, or already sent through the revisioned account adapter.

### I3. Overrides Belong to a Repeated Occurrence, Not the Task Template

A repeated task is a template. Its actual instances receive ids such as
`taskId|occ|2026-09-23`. Manual pins, skipped dates, and time blocks live under
that occurrence id. A single one-off task uses its task id as its occurrence
id.

**Why this matters:** putting an override on `taskId` would make “move this
Tuesday's school-planning block” also move, skip, or time-lock future Tuesdays.
That is wrong both mechanically and psychologically: the person acted on one
instance, not on the rule that generates every instance.

**Step 3 implication:** recurrence data can be reused/migrated only if v02
retains occurrence identity. The v01-v02 matrix must mark each manual-control
feature as occurrence-scoped and include an acceptance test that an override
does not bleed into the next repeat.

### I4. An Explicit Human Instruction Wins, Even When It Causes a Problem

Pins, exclusions, fixed day amounts, fixed times, and accepted overwork are
intentional instructions. The engine keeps them. If that makes the remaining
demand impossible before the deadline, it reports a shortfall; it does not
quietly undo the instruction or relocate a fixed block.

**Why this matters:** silently “repairing” a calendar may look neat but breaks
trust. The person cannot reason about a schedule that changes an instruction
behind their back. The correct response is a focused conflict/resolution state.

**Step 3 implication:** v02 needs an explicit distinction between automatic
work and user-controlled work in both data and UI. The mapping matrix must
record what shortfall/review surface appears for impossible constraints, not
only how a user creates the constraint.

### I5. Skip Removes a Date From This Occurrence; It Does Not Erase Work

Skip sets `excludedDates` for the occurrence/date, equivalent to a zero-hour
manual allocation. It prevents automatic scheduling there. The task's expected
demand remains; the allocator attempts later eligible dates. If none exist,
the plan exposes a shortfall. Completing a task and skipping a block are thus
not the same operation.

**Why this matters:** treating Skip as task deletion loses unmet work; treating
it as completed corrupts completion history. Repeated skip must not repeatedly
add demand either, because the demand was never removed.

**Step 3 implication:** Calico v02's requested “Skipped” outcome should render
the block greyed out/removed while retaining recoverable data, but its scheduler
semantics must be this exclusion model. Reversal means remove the exclusion,
not recreate the task from scratch.

### I6. Carry Forward Only Real, Past, Unfinished Work, Once

For a past logged date, the engine adds `scheduled - completed` to future
demand. A current or future task whose checkbox is toggled off has no missed
history yet, so v01 deletes/neutralises its log rather than adding demand. The
date/task log makes this calculation idempotent across rerenders and reloads.

**Why this matters:** without this distinction, a person checking and
unchecking today’s block can double the required work. Without idempotency,
opening the application repeatedly after an incomplete day compounds a single
miss into several future hours.

**Step 3 implication:** the v02 mapping row for Completed, Partially completed,
Incomplete, and Skipped must distinguish progress log data from manual
schedule constraints. Test partial carry-forward, a current-day toggle, and a
repeated task occurrence separately.

### I7. Time Constraints Have a Deliberate Strength Order

The order is: event/availability occupied time; a valid fixed task time;
preferred task time when no stronger block occupies it; then flexible automatic
placement. A fixed time reserves an exact interval and triggers collision
validation. Preferred time is a request, not a promise: it yields to a fixed
calendar commitment and can become flexible without being an error.

**Why this matters:** using one generic “pinned to time” flag makes it
impossible to respect calendar commitments while offering a flexible
preference. It also makes the user-facing wording lie about whether Calico may
move the block.

**Step 3 implication:** retain separate `preferred` and `fixed` values, their
different validation rules, and visibly distinguish their outcomes. Do not map
both to one v02 control simply because their data shape looks similar.

### I8. Capacity Is Calculated in a Specific Order

For a date, v01 chooses the daily working window (date override before default),
chooses maximum task capacity (date override before weekday/default), caps that
maximum by window duration, scales by `intensity / baseline`, caps at 24, then
subtracts event and availability durations. Task allocation consumes the
result. Task-scoped accepted overwork is a later exception for that particular
occurrence, not a change to the shared capacity number.

**Why this matters:** changing the order changes the amount schedulable. For
example, subtracting events before intensity scales commitments as though less
of the meeting existed; treating overwork as daily capacity could let unrelated
tasks take it.

**Step 3 implication:** capacity should be represented as a testable service
with these inputs and intermediary outputs. The matrix needs separate rows for
baseline intensity, daily intensity, default/weekday/day working hours, events,
availability, and task-scoped overwork, while preserving this order in the
acceptance criteria.

### I9. Project Filtering Cannot Change the Plan

Projects are organisational metadata. Hiding Personal or a project only hides
its rendered tasks from a surface. Those tasks continue to consume capacity,
affect conflicts, and appear again when the filter is restored. Deleting a
project unassigns its tasks; it does not delete or reschedule them.

**Why this matters:** if filtering removed demand before scheduling, the plan
would change depending on which chips are selected. A user could unknowingly
create capacity simply by hiding a project, and unhide it into an impossible
week.

**Step 3 implication:** keep filters outside the plan cache key/canonical
scheduler input. The v02 mapping must separately describe data management,
visibility filtering, and project deletion behaviour.

### I10. Portable and Syncable State Must Exclude Device Credentials/Metadata

Backup and Supabase payloads include planning state, not account state. The
local `account` object has a revision, sync timing/error, and email for the
current browser. It would be misleading and potentially unsafe to restore that
onto another browser. Version 6 additionally strips a retired `cloud` adapter,
including any legacy token.

**Why this matters:** importing a backup must not impersonate a session, force a
stale revision, leak an email/token, or make a second device believe it has
already completed a sync. It also prevents old storage data from reviving a
retired credential path.

**Step 3 implication:** state schemas should make the boundary explicit:
`planningState` is portable/syncable; `deviceAccountMetadata` is local only.
The mapping matrix must include a migration and tests for both export and
account payload filtering.

### I11. Revision Mismatch Must Stop, Not Guess

The Supabase save RPC takes an expected revision. It updates the single row only
when that revision matches. No returned row means another device wrote first.
v01 records a local error and pauses sync. It does not pick the newest timestamp,
merge fields, or overwrite the remote copy automatically.

**Why this matters:** a last-write-wins retry would silently discard a real edit
on another device. An automatic merge is also unsafe without an explicit model
for merging schedules, task logs, repeated overrides, and deletes.

**Step 3 implication:** v02 may improve the conflict-resolution experience in a
later slice, but it cannot replace “stop safely” with silent overwrite. Until a
designed merge surface and tested merge rules exist, stalled sync is the correct
behaviour.

### I12. Validation and Normalisation Are Core Behaviour

There are two complementary layers. Form validation stops impossible inputs at
the point of entry: empty name, task below 0.5h, event end before start, reversed
working window, too-large fixed amount, or an invalid fixed-time collision.
Normalisation protects every other ingress: old local storage, an imported JSON
file, a Supabase row, or a future migration. It clamps values, removes malformed
dates/time blocks, repairs project links, and deletes retired credentials before
the scheduler reads state.

**Why this matters:** form validation alone assumes all data was created through
the current UI. That is false as soon as there are old versions, backups,
account sync, or developer tools. Normalisation alone is not enough either,
because it turns a person’s bad input into a confusing later repair rather than
giving immediate feedback.

**Step 3 implication:** each mapped feature needs both an entry validation rule
and a normalisation/migration rule. Reusing a v01 data field without carrying
its validation semantics is not feature parity.
