import test from 'node:test';
import assert from 'node:assert/strict';
import { activateScenario, advanceResponse, createSimulation, getTelemetry, resolveCurrentAlert, SCENARIOS } from '../src/simulation.ts';

test('an intrusion creates one pending alert and coordinates three sensor types', () => {
  const state = activateScenario(createSimulation(10000000), 'person', 10000100);
  assert.equal(state.scenario, 'person');
  assert.equal(state.alerts.filter((alert) => alert.resolvedAt === null).length, 1);
  assert.equal(state.alerts[0].createdAt, 10000100);
  assert.equal(state.alerts[0].phase, 'detected');
  assert.deepEqual(SCENARIOS[state.scenario].sensors, ['camera', 'infrared', 'radar']);
  assert.equal(activateScenario(state, 'person', 10000200), state);
});

test('switching scenarios archives the previous simulation instead of losing it', () => {
  const first = activateScenario(createSimulation(10000000), 'animal', 10000100);
  const second = activateScenario(first, 'slope', 10000200);
  assert.equal(second.alerts.length, first.alerts.length + 1);
  assert.equal(second.alerts[1].resolvedAt, 10000200);
  assert.equal(second.alerts[1].outcome, 'cancelled');
  assert.equal(second.alerts[1].timeline.at(-1).phase, 'resolved');
  assert.equal(second.alerts[0].resolvedAt, null);
  assert.notEqual(second.alerts[0].id, second.alerts[1].id);
  assert.equal(first.alerts[0].resolvedAt, null);
});

test('completing the response or returning to patrol clears the risk with distinct outcomes', () => {
  const active = activateScenario(createSimulation(10000000), 'rockfall', 10000100);
  const responding = advanceResponse(advanceResponse(active, 10000150), 10000200);
  const handled = resolveCurrentAlert(responding, 10000300);
  const cancelled = activateScenario(active, 'normal', 10000300);
  for (const resolved of [handled, cancelled]) {
    assert.equal(resolved.scenario, 'normal');
    assert.equal(resolved.alerts.length, active.alerts.length);
    assert.ok(resolved.alerts.every((alert) => alert.resolvedAt !== null));
  }
  assert.equal(handled.alerts[0].outcome, 'handled');
  assert.equal(cancelled.alerts[0].outcome, 'cancelled');
});

test('response phases cannot be skipped and each action retains its timestamped evidence', () => {
  const detected = activateScenario(createSimulation(10000000), 'person', 10000100);
  assert.equal(resolveCurrentAlert(detected, 10000110), detected);
  const verified = advanceResponse(detected, 10000200);
  assert.equal(verified.alerts[0].phase, 'verified');
  assert.equal(resolveCurrentAlert(verified, 10000210), verified);
  const responding = advanceResponse(verified, 10000300);
  assert.equal(advanceResponse(responding, 10000310), responding);
  const resolved = resolveCurrentAlert(responding, 10000400);
  assert.deepEqual(resolved.alerts[0].timeline.map(({ phase, at }) => [phase, at]), [
    ['detected', 10000100], ['verified', 10000200], ['responding', 10000300], ['resolved', 10000400],
  ]);
  assert.equal(resolved.scenario, 'normal');
  assert.equal(resolveCurrentAlert(resolved, 10000500), resolved);
  assert.equal(detected.alerts[0].timeline.length, 1);
});

test('rain and slope simulations cross the documented thresholds while patrol remains safe', () => {
  for (const seconds of [0, 15, 120, 600]) {
    assert.ok(getTelemetry('rain', seconds).rainRate > 30);
    assert.ok(getTelemetry('slope', seconds).displacement > 3);
    assert.ok(getTelemetry('normal', seconds).rainRate < 30);
    assert.ok(getTelemetry('normal', seconds).displacement < 3);
  }
});

test('every abnormal scenario produces an actionable alert with relevant sensing devices', () => {
  for (const scenario of ['person', 'animal', 'rain', 'slope', 'rockfall']) {
    const state = activateScenario(createSimulation(10000000), scenario, 10000100);
    assert.equal(state.alerts[0].scenario, scenario);
    assert.ok(SCENARIOS[scenario].sensors.length >= 2);
    assert.notEqual(SCENARIOS[scenario].risk, 'normal');
  }
});
