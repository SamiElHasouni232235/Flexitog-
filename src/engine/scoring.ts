import type { Criterion, Model } from './types';
import type { ModelResult } from './model';

export const MIN_SCORE = 1;
export const MAX_SCORE = 10;
export const EQUAL_SCORE = 5.5;

/**
 * Linear position between worst and best value on a 1 to 10 scale.
 * score = 1 + 9 * (value - worst) / (best - worst). All values equal gives 5.5.
 */
export function linearScore(value: number, worst: number, best: number): number {
  if (best === worst) return EQUAL_SCORE;
  const t = (value - worst) / (best - worst);
  return MIN_SCORE + (MAX_SCORE - MIN_SCORE) * Math.min(1, Math.max(0, t));
}

/** Rating 1 to 5 mapped to 1 to 10: score = 1 + (rating - 1) * 9 / 4. */
export function ratingToScore(rating: number): number {
  const r = Math.min(5, Math.max(1, rating));
  return MIN_SCORE + ((r - 1) * (MAX_SCORE - MIN_SCORE)) / 4;
}

/** Calculated scores for a list of metric values. Null values get a null score. */
export function scoreValues(values: Array<number | null>, higherIsBetter: boolean): Array<number | null> {
  const finite = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (finite.length === 0) return values.map(() => null);
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const best = higherIsBetter ? max : min;
  const worst = higherIsBetter ? min : max;
  return values.map((v) => (v === null || !Number.isFinite(v) ? null : linearScore(v, worst, best)));
}

export interface CriterionScore {
  criterionId: string;
  metricValue: number | null;
  calculated: number | null;
  rating: number | null;
  ratingScore: number | null;
  final: number;
}

export interface ModelScore {
  modelId: string;
  scores: CriterionScore[];
  total: number;
  rank: number;
}

/** Blend: blend * calculated + (1 - blend) * rating score. Manual criteria and missing values use one side only. */
export function blendScore(calculated: number | null, ratingScore: number | null, blendCalculated: number): number {
  const b = Math.min(1, Math.max(0, blendCalculated));
  if (calculated !== null && ratingScore !== null) return b * calculated + (1 - b) * ratingScore;
  if (calculated !== null) return calculated;
  if (ratingScore !== null) return ratingScore;
  return EQUAL_SCORE;
}

/** Weighted total = sum(weight * score) / sum(weight). Equal weights when all weights are 0. */
export function weightedTotal(scores: number[], weights: number[]): number {
  const w = weights.map((x) => Math.max(0, x));
  const totalW = w.reduce((s, x) => s + x, 0);
  if (scores.length === 0) return 0;
  if (totalW <= 0) return scores.reduce((s, x) => s + x, 0) / scores.length;
  return scores.reduce((s, x, i) => s + x * (w[i] ?? 0), 0) / totalW;
}

/** Score and rank models. Ties share a rank (1, 2, 2, 4). */
export function scoreModels(
  models: Model[],
  results: ModelResult[],
  criteria: Criterion[],
  blendCalculated: number,
): ModelScore[] {
  const resultById = new Map(results.map((r) => [r.modelId, r]));
  const perCriterion = criteria.map((c) => {
    const values = models.map((m) => {
      if (c.metric === 'manual') return null;
      return resultById.get(m.id)?.metrics[c.metric] ?? null;
    });
    return { values, calculated: c.metric === 'manual' ? values.map(() => null) : scoreValues(values, c.higherIsBetter) };
  });

  const unranked = models.map((m, mi) => {
    const scores: CriterionScore[] = criteria.map((c, ci) => {
      const pc = perCriterion[ci];
      const rawRating = m.ratings[c.id];
      const rating = typeof rawRating === 'number' && rawRating >= 1 ? rawRating : null;
      const ratingScore = rating !== null ? ratingToScore(rating) : null;
      const calculated = pc?.calculated[mi] ?? null;
      return {
        criterionId: c.id,
        metricValue: pc?.values[mi] ?? null,
        calculated,
        rating,
        ratingScore,
        final: blendScore(calculated, ratingScore, blendCalculated),
      };
    });
    const total = weightedTotal(
      scores.map((s) => s.final),
      criteria.map((c) => c.weight),
    );
    return { modelId: m.id, scores, total, rank: 0 };
  });

  const sorted = [...unranked].sort((a, b) => b.total - a.total);
  for (const s of unranked) {
    s.rank = 1 + sorted.filter((o) => o.total > s.total + 1e-9).length;
  }
  return unranked;
}
