import test from 'node:test';
import assert from 'node:assert/strict';
import { getLanguage, LANGUAGE_STORAGE_KEY, message, messages, restoreLanguage, saveLanguage, setLanguage, t, translateMessage } from '../src/i18n.ts';
import { activateScenario, advanceResponse, createSimulation, DEVICES, RESPONSE_PLANS, SCENARIOS, sensorReading, getTelemetry } from '../src/simulation.ts';

test('English messages interpolate zero values and resolve nested localized messages', () => {
  setLanguage('en');
  assert.equal(t('devices.count', { count: 0 }), 'Sensors: 0');
  assert.equal(translateMessage(message('record.dispatched', { action: message('response.plan.person.action') })), 'Dispatch patrol: response task dispatched in simulation');
  assert.throws(() => t('devices.count'), /Missing translation parameter/);
  setLanguage('zh');
  assert.equal(t('devices.count', { count: 0 }), '共 0 台设备');
});

test('language preferences round-trip and unavailable storage reports failure without blocking translation', (context) => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  restoreLanguage(storage);
  assert.equal(getLanguage(), 'zh');
  setLanguage('en');
  assert.equal(saveLanguage(storage), true);
  assert.equal(values.get(LANGUAGE_STORAGE_KEY), 'en');
  setLanguage('zh');
  restoreLanguage(storage);
  assert.equal(getLanguage(), 'en');
  const warning = context.mock.method(console, 'warn', () => {});
  assert.equal(saveLanguage({ getItem: () => null, setItem: () => { throw new Error('Storage disabled'); } }), false);
  assert.equal(getLanguage(), 'en');
  assert.equal(warning.mock.callCount(), 1);
  restoreLanguage(null);
  assert.equal(getLanguage(), 'zh');
});

test('switching language translates existing history and sensor metadata without changing workflow state', () => {
  setLanguage('zh');
  const state = advanceResponse(activateScenario(createSimulation(10000000), 'person', 10000100), 10000200);
  const before = JSON.stringify(state);
  const originalNote = translateMessage(state.alerts[0].timeline[0].note);
  setLanguage('en');
  assert.equal(JSON.stringify(state), before);
  assert.equal(state.alerts[0].phase, 'verified');
  assert.equal(SCENARIOS.person.name, 'Person intrusion');
  assert.equal(DEVICES[0].name, 'HD camera 01');
  assert.equal(RESPONSE_PLANS.person.action, 'Dispatch patrol');
  assert.match(translateMessage(state.alerts[0].timeline[0].note), /Person intrusion simulation started/);
  assert.notEqual(translateMessage(state.alerts[0].timeline[0].note), originalNote);
  assert.equal(sensorReading('camera', getTelemetry('person', 0), 'person'), 'Target locked');
  setLanguage('zh');
  assert.equal(translateMessage(state.alerts[0].timeline[0].note), originalNote);
});

test('every bilingual message keeps matching parameters and an English-only translation', () => {
  const tokens = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const [key, [zh, en]] of Object.entries(messages)) {
    assert.ok(zh.length && en.length, `${key} has a missing translation`);
    assert.deepEqual(tokens(zh), tokens(en), `${key} has mismatched interpolation parameters`);
    assert.doesNotMatch(en, /\p{Script=Han}/u, `${key} is not translated into English`);
  }
});
