import { uid } from '../data/templates';
import { METRIC_BY_KEY, METRICS } from '../engine/metrics';
import type { MetricKey } from '../engine/types';
import { useApp } from '../state/store';
import { fmtNum, fmtPct } from '../ui/format';
import { NumberInput } from '../ui/NumberInput';

export function CriteriaPage() {
  const criteria = useApp((s) => s.ws.criteria);
  const blend = useApp((s) => s.ws.settings.blendCalculated);
  const { updateCriterion, addCriterion, removeCriterion, updateSettings } = useApp.getState();
  const totalWeight = criteria.reduce((s, c) => s + Math.max(0, c.weight), 0);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Criteria and weights</h1>
          <p>Each criterion scores models from 1 (worst) to 10 (best). The weighted total ranks the models.</p>
        </div>
        <button
          onClick={() => addCriterion({ id: uid('crit'), name: 'New criterion', weight: 10, metric: 'manual', higherIsBetter: true })}
        >
          Add criterion
        </button>
      </div>

      <div className="card">
        <h2>Blend of calculated scores and ratings</h2>
        <div className="row" style={{ maxWidth: 640 }}>
          <label htmlFor="blend" className="nowrap">
            Calculated share
          </label>
          <input
            id="blend"
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(blend * 100)}
            onChange={(e) => updateSettings({ blendCalculated: Number(e.target.value) / 100 })}
            style={{ flex: 1 }}
            aria-valuetext={`${Math.round(blend * 100)}% calculated, ${Math.round((1 - blend) * 100)}% rating`}
          />
          <strong className="nowrap">
            {fmtPct(blend)} calculated, {fmtPct(1 - blend)} rating
          </strong>
        </div>
        <p className="muted small" style={{ marginTop: 6 }}>
          Score = calculated share × calculated score + rating share × rating score. A rating of 1 gives 1 and a rating of 5 gives 10.
          Criteria with metric “manual rating only” use the rating alone.
        </p>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th className="num">Weight</th>
                <th className="num">Share</th>
                <th>Metric</th>
                <th>Direction</th>
                <th>What it measures</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {criteria.map((c) => (
                <tr key={c.id}>
                  <td style={{ minWidth: 240 }}>
                    <input value={c.name} onChange={(e) => updateCriterion(c.id, { name: e.target.value })} aria-label="Criterion name" />
                  </td>
                  <td style={{ width: 90 }}>
                    <NumberInput value={c.weight} min={0} onChange={(weight) => updateCriterion(c.id, { weight })} label="Weight" />
                  </td>
                  <td className="num">{totalWeight > 0 ? fmtPct(Math.max(0, c.weight) / totalWeight) : '–'}</td>
                  <td>
                    <select
                      value={c.metric}
                      aria-label="Metric"
                      onChange={(e) => {
                        const metric = e.target.value as MetricKey;
                        updateCriterion(c.id, { metric, higherIsBetter: METRIC_BY_KEY.get(metric)?.higherIsBetter ?? true });
                      }}
                    >
                      {METRICS.map((m) => (
                        <option key={m.key} value={m.key}>
                          {m.label}
                          {m.unit ? ` (${m.unit})` : ''}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={c.higherIsBetter ? 'higher' : 'lower'}
                      onChange={(e) => updateCriterion(c.id, { higherIsBetter: e.target.value === 'higher' })}
                      disabled={c.metric === 'manual'}
                      aria-label="Direction"
                    >
                      <option value="lower">Lower is better</option>
                      <option value="higher">Higher is better</option>
                    </select>
                  </td>
                  <td className="small muted">{METRIC_BY_KEY.get(c.metric)?.description}</td>
                  <td>
                    <button className="link" onClick={() => confirm(`Delete criterion ${c.name}?`) && removeCriterion(c.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="num">{fmtNum(totalWeight, 0)}</td>
                <td className="num">{totalWeight > 0 ? '100%' : '–'}</td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="muted small" style={{ marginTop: 6 }}>
          Weights do not need to add up to 100. The tool divides by the total weight.
        </p>
      </div>
    </>
  );
}
