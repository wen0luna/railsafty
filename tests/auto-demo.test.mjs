import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutoDemoSequence, nextAutoDemoIndex } from '../src/auto-demo.ts';

const scenarios = ['person', 'animal', 'rain', 'slope', 'rockfall'];

test('the automatic demo presents patrol first, then each incident through simulated close-out', () => {
  const steps = createAutoDemoSequence(scenarios);
  assert.deepEqual(steps.slice(0, 2).map(({ kind }) => kind), ['overview', 'patrol']);
  assert.deepEqual(steps.filter(({ kind }) => kind === 'scenario').map(({ scenario }) => scenario), scenarios);
  for (const scenario of scenarios) {
    assert.deepEqual(
      steps.filter((step) => 'scenario' in step && step.scenario === scenario).map(({ kind }) => kind),
      ['scenario', 'fusion', 'review', 'dispatch', 'recheck'],
    );
  }
  assert.equal(steps.at(-1).kind, 'complete');
  assert.ok(steps.every(({ durationMs }) => durationMs > 0));
});

test('the automatic demo advances normally and only wraps when looping is enabled', () => {
  assert.equal(nextAutoDemoIndex(0, 3, false), 1);
  assert.equal(nextAutoDemoIndex(2, 3, false), null);
  assert.equal(nextAutoDemoIndex(2, 3, true), 0);
  assert.equal(nextAutoDemoIndex(0, 0, true), null);
});
