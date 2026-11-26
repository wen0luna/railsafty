import type { MessageKey } from './i18n.ts';
import type { ScenarioId } from './simulation.ts';

export type AutoDemoScenario = Exclude<ScenarioId, 'normal'>;

export type AutoDemoStep =
  | { kind: 'overview' | 'patrol' | 'complete'; title: MessageKey; durationMs: number }
  | { kind: 'scenario' | 'fusion' | 'review' | 'dispatch' | 'recheck'; scenario: AutoDemoScenario; title: MessageKey; durationMs: number };

export function createAutoDemoSequence(scenarios: readonly AutoDemoScenario[]): AutoDemoStep[] {
  const incidentSteps = scenarios.flatMap((scenario): AutoDemoStep[] => [
    { kind: 'scenario', scenario, title: 'demo.stage.scenario', durationMs: 4500 },
    { kind: 'fusion', scenario, title: 'demo.stage.fusion', durationMs: 4000 },
    { kind: 'review', scenario, title: 'demo.stage.review', durationMs: 1800 },
    { kind: 'dispatch', scenario, title: 'demo.stage.dispatch', durationMs: 1800 },
    { kind: 'recheck', scenario, title: 'demo.stage.recheck', durationMs: 1800 },
  ]);

  return [
    { kind: 'overview', title: 'demo.stage.overview', durationMs: 5000 },
    { kind: 'patrol', title: 'demo.stage.patrol', durationMs: 7000 },
    ...incidentSteps,
    { kind: 'complete', title: 'demo.stage.complete', durationMs: 3500 },
  ];
}

export function nextAutoDemoIndex(currentIndex: number, stepCount: number, loop: boolean): number | null {
  const nextIndex = currentIndex + 1;
  if (nextIndex < stepCount) return nextIndex;
  return loop && stepCount > 0 ? 0 : null;
}
