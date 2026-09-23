# Calico v02 Build Manual

## Purpose

Build Calico v02 to match the  desktop mockup exactly while carrying
forward the selected, proven Calico v01 mechanisms without losing
features or existing user data.

## Source Of Truth

- The approved v02 mockup is the visual source of truth.
- Calico v01 is the source of truth for existing behaviour, data, and tests.
- Do not import v01 visual compromises into v02.
- Do not add, remove, or defer a feature without recording the decision in the
  v01-v02 mapping matrix.

## Delivery Order

### 1. Build The Exact Static v02 Shell

Create the desktop HTML, CSS, and lightweight JavaScript needed to reproduce
the approved mockup using stable representative data. Match layout, spacing,
typography, navigation, controls, calendar geometry, and block treatments.

Immediately run visual QA against the approved mockup at the same viewport.
Do not begin feature porting until visual differences are resolved or explicitly
flagged.

### 2. Inventory v01

Document every v01 feature, including its data shape, scheduling mechanism,
user-visible outcome, current entry point, edge cases, and existing test
coverage.

### 3. Maintain The v01-v02 Mapping Matrix

For every v01 feature, record:

- v01 mechanism and stored data;
- required v02 location and visual counterpart;
- parity decision: required now, designed but deferred, or intentionally
  retired;
- data compatibility: direct reuse, migration required, or no existing data;
- test coverage and acceptance criteria.

Nothing is omitted because its former v01 interface does not fit the mockup.

### 4. Complete v02 Surfaces For The Matrix

Where the approved mockup does not yet accommodate a required v01 mechanism,
design its exact v02 counterpart before porting the mechanism. Keep the v02
visual language authoritative.

Immediately run visual QA on every completed surface.

### 5. Port And Link Logic In Coherent Slices

Move selected v01 scheduling and state logic into v02 without duplicating or
rewriting proven rules unnecessarily. Connect one coherent area at a time and
keep v01's relevant tests passing: for example tasks, events, availability,
projects, Review, settings, and account sync.

Immediately run visual QA after each linked slice, as well as functional and
regression tests.

### 6. Specify And Implement Interactions

Only after the related logic is connected, define the exact interactions that
surface needs: selection, drag and drop, task completion, validation, empty
states, conflict resolution, hover/focus behaviour, confirmations, and error
states. Keep the interaction specification tied to the mapping matrix.

Immediately run visual QA and interaction tests after each interaction set.

## Quality Gate

Before declaring any v02 area complete:

1. Its visual QA matches the approved v02 design at the agreed desktop size.
2. Its mapping-matrix parity and data-compatibility decisions are complete.
3. Its v01-derived logic and regression tests pass.
4. Its required interactions are specified, implemented, and tested.
5. Any unresolved mismatch is plainly reported; never replace it with an
   unapproved substitute.
