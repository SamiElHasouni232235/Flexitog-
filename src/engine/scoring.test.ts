import { describe, expect, it } from 'vitest';
import { seedWorkspace } from '../data/seed';
import { evaluateAll } from './model';
import type { ModelResult } from './model';
import { blendScore, linearScore, ratingToScore, scoreModels, scoreValues, weightedTotal } from './scoring';
import { seedInput } from './testUtils';
import type { Criterion, Model } from './types';

describe('scoring', () => {
  it('scores 1 for worst, 10 for best and linear in between', () => {
    expect(linearScore(100, 100, 200)).toBe(1);
    expect(linearScore(200, 100, 200)).toBe(10);
    expect(linearScore(150, 100, 200)).toBe(5.5);
  });

  it('handles lower is better', () => {
    expect(scoreValues([10, 20, 30], false)).toEqual([10, 5.5, 1]);
    expect(scoreValues([10, 20, 30], true)).toEqual([1, 5.5, 10]);
  });

  it('gives 5.5 when all values are equal', () => {
    expect(scoreValues([7, 7, 7], false)).toEqual([5.5, 5.5, 5.5]);
  });

  it('maps rating 1 to 1 and 5 to 10', () => {
    expect(ratingToScore(1)).toBe(1);
    expect(ratingToScore(3)).toBe(5.5);
    expect(ratingToScore(5)).toBe(10);
  });

  it('blends calculated and rating scores', () => {
    expect(blendScore(10, 1, 0.6)).toBeCloseTo(6.4, 9);
    expect(blendScore(null, 10, 0.6)).toBe(10);
    expect(blendScore(4, null, 0.6)).toBe(4);
  });

  it('builds a weighted total', () => {
    expect(weightedTotal([10, 1], [3, 1])).toBeCloseTo(7.75, 9);
    expect(weightedTotal([10, 2], [0, 0])).toBe(6);
  });

  it('scores manual criteria from the rating only', () => {
    const ws = seedWorkspace();
    const models = ws.models.slice(0, 2).map((m, i) => ({ ...m, ratings: { manual: i === 0 ? 5 : 1 } })) as Model[];
    const criteria: Criterion[] = [{ id: 'manual', name: 'Fit', weight: 1, metric: 'manual', higherIsBetter: true }];
    const results = evaluateAll(seedInput(ws), models, ws.scenarios[1]!);
    const scores = scoreModels(models, results, criteria, 0.6);
    expect(scores[0]!.scores[0]!.calculated).toBeNull();
    expect(scores[0]!.total).toBe(10);
    expect(scores[1]!.total).toBe(1);
    expect(scores[0]!.rank).toBe(1);
    expect(scores[1]!.rank).toBe(2);
  });

  it('ranks models and keeps metric value, calculated score and rating for hover', () => {
    const ws = seedWorkspace();
    const results = evaluateAll(seedInput(ws), ws.models, ws.scenarios[1]!);
    const scores = scoreModels(ws.models, results, ws.criteria, 0.6);
    const ranks = scores.map((s) => s.rank).sort();
    expect(ranks[0]).toBe(1);
    for (const s of scores) {
      expect(s.total).toBeGreaterThanOrEqual(1);
      expect(s.total).toBeLessThanOrEqual(10);
      for (const c of s.scores) {
        expect(c.metricValue).not.toBeNull();
        expect(c.calculated).not.toBeNull();
        expect(c.rating).not.toBeNull();
      }
    }
  });

  it('gives tied models the same rank', () => {
    const ws = seedWorkspace();
    const twin = { ...ws.models[0]!, id: 'twin' };
    const models = [ws.models[0]!, twin];
    const results = evaluateAll(seedInput(ws), models, ws.scenarios[1]!) as ModelResult[];
    const scores = scoreModels(models, results, ws.criteria, 0.6);
    expect(scores.map((s) => s.rank)).toEqual([1, 1]);
  });
});
