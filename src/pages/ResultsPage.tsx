import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { countDummyInputs } from '../engine/dummy';
import { METRIC_BY_KEY } from '../engine/metrics';
import { evaluateAll } from '../engine/model';
import type { ModelResult } from '../engine/model';
import { scoreModels } from '../engine/scoring';
import type { ModelScore } from '../engine/scoring';
import type { Criterion, Model } from '../engine/types';
import { useApp, useAssumptionValues, useStores } from '../state/store';
import { DummyBadge } from '../ui/DataFlag';
import { fmtEur, fmtEurShort, fmtMetric, fmtNum, fmtPct } from '../ui/format';
import { CATEGORICAL } from '../ui/hubColours';
import { NetworkMap } from '../ui/NetworkMap';
import { scoreColours, useIsDark } from '../ui/useIsDark';
import { HUB_ROLE_LABELS } from './ModelsPage';

interface Row {
  model: Model;
  result: ModelResult;
  score: ModelScore;
}

export function ResultsPage() {
  const ws = useApp((s) => s.ws);
  const { updateSettings } = useApp.getState();
  const stores = useStores();
  const scenario = ws.scenarios.find((s) => s.id === ws.settings.selectedScenarioId) ?? ws.scenarios[0];

  const rows = useMemo<Row[]>(() => {
    if (!scenario) return [];
    const input = { products: ws.products, dc: ws.dc, hubs: ws.hubs, stores, assumptions: ws.assumptions };
    const results = evaluateAll(input, ws.models, scenario);
    const scores = scoreModels(ws.models, results, ws.criteria, ws.settings.blendCalculated);
    return ws.models.map((model, i) => ({ model, result: results[i] as ModelResult, score: scores[i] as ModelScore }));
  }, [ws.products, ws.dc, ws.hubs, stores, ws.assumptions, ws.models, ws.criteria, ws.settings.blendCalculated, scenario]);

  const dummy = countDummyInputs(ws, scenario?.id);
  const ranked = [...rows].sort((a, b) => a.score.rank - b.score.rank);
  const baseline = rows.find((r) => r.model.id === ws.settings.baselineModelId) ?? rows[0];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Results</h1>
          <p>Every model runs on the same scenario. Scores run from 1 (worst) to 10 (best).</p>
        </div>
        <div className="row">
          <label className="check" htmlFor="scenario-pick">
            Scenario
          </label>
          <select id="scenario-pick" value={scenario?.id ?? ''} onChange={(e) => updateSettings({ selectedScenarioId: e.target.value })}>
            {ws.scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {scenario && <DummyBadge show={scenario.isDummy} />}
          <label className="check" htmlFor="baseline-pick">
            Baseline
          </label>
          <select id="baseline-pick" value={ws.settings.baselineModelId} onChange={(e) => updateSettings({ baselineModelId: e.target.value })}>
            {ws.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="notice" role="note">
        <strong>
          {dummy.dummy} of {dummy.total} inputs are dummy data.
        </strong>{' '}
        <span className="small">
          {dummy.groups
            .filter((g) => g.total > 0)
            .map((g) => `${g.label} ${g.dummy}/${g.total}`)
            .join(' · ')}
        </span>
        {dummy.dummy > 0 && <span className="small"> Results are placeholders until every input is marked as real data.</span>}
      </div>

      {!scenario || rows.length === 0 ? (
        <div className="card">Add at least one scenario and one model to see results.</div>
      ) : (
        <>
          <Summary ranked={ranked} baseline={baseline} />
          <RankingTable ranked={ranked} baseline={baseline} baselineId={ws.settings.baselineModelId} />
          <Heatmap ranked={ranked} criteria={ws.criteria} blend={ws.settings.blendCalculated} />
          <div className="grid-2">
            <RadarCard rows={rows} criteria={ws.criteria} />
            <CostBars rows={rows} />
          </div>
          <KeyFigures rows={rows} baseline={baseline} />
          <MapsCard rows={rows} />
          <Points ranked={ranked} criteria={ws.criteria} />
        </>
      )}
    </>
  );
}

const pctChange = (value: number | null, base: number | null): number | null =>
  value === null || base === null || !Number.isFinite(value) || !Number.isFinite(base) || base === 0 ? null : (value - base) / Math.abs(base);

function Delta({ value, base, lowerIsBetter = true }: { value: number | null; base: number | null; lowerIsBetter?: boolean | null }) {
  const d = pctChange(value, base);
  if (d === null) return <span className="muted">–</span>;
  if (Math.abs(d) < 0.0005) return <span className="muted">0%</span>;
  const better = lowerIsBetter === null ? null : lowerIsBetter ? d < 0 : d > 0;
  const cls = better === null ? 'muted' : better ? 'delta-good' : 'delta-bad';
  return (
    <span className={cls} title={better === null ? undefined : better ? 'Better than baseline' : 'Worse than baseline'}>
      {d > 0 ? '▲ +' : '▼ '}
      {fmtPct(d, 1)}
    </span>
  );
}

function Summary({ ranked, baseline }: { ranked: Row[]; baseline: Row | undefined }) {
  const top = ranked[0];
  if (!top || !baseline) return null;
  const isBase = top.model.id === baseline.model.id;
  const d = pctChange(top.result.totalCost, baseline.result.totalCost);
  return (
    <p className="summary-line">
      <strong>{top.model.name}</strong> ranks first with {fmtNum(top.score.total, 2)} of 10 at {fmtEurShort(top.result.totalCost)} per year
      ({fmtEur(top.result.costPerUnit, 3)} per unit)
      {isBase
        ? ', and it is the baseline.'
        : `, ${d !== null ? `${fmtPct(Math.abs(d), 1)} ${d < 0 ? 'below' : 'above'}` : 'compared with'} the baseline cost of ${fmtEurShort(baseline.result.totalCost)}, with ${fmtNum(top.result.ownFte, 1)} own FTE against ${fmtNum(baseline.result.ownFte, 1)}.`}
    </p>
  );
}

function RankingTable({ ranked, baseline, baselineId }: { ranked: Row[]; baseline: Row | undefined; baselineId: string }) {
  return (
    <div className="card">
      <h2>Ranking</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th className="num">Rank</th>
              <th>Model</th>
              <th className="num">Score</th>
              <th className="num">Total cost</th>
              <th className="num">Cost vs baseline</th>
              <th className="num">Cost per unit</th>
              <th className="num">Own FTE</th>
              <th className="num">CO2 t</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r) => (
              <tr key={r.model.id}>
                <td className="num">{r.score.rank}</td>
                <td>
                  <span className="swatch" style={{ background: r.model.colour }} />
                  {r.model.name} {r.model.id === baselineId && <span className="badge neutral">Baseline</span>} <DummyBadge show={r.model.isDummy} />
                </td>
                <td className="num">
                  <strong>{fmtNum(r.score.total, 2)}</strong>
                </td>
                <td className="num">{fmtEur(r.result.totalCost)}</td>
                <td className="num">
                  <Delta value={r.result.totalCost} base={baseline?.result.totalCost ?? null} />
                </td>
                <td className="num">{fmtEur(r.result.costPerUnit, 3)}</td>
                <td className="num">{fmtNum(r.result.ownFte, 1)}</td>
                <td className="num">{fmtNum(r.result.co2Kg / 1000, 0)}</td>
                <td className="small error-text">{r.result.warnings.join(' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Heatmap({ ranked, criteria, blend }: { ranked: Row[]; criteria: Criterion[]; blend: number }) {
  const dark = useIsDark();
  const totalW = criteria.reduce((s, c) => s + Math.max(0, c.weight), 0);
  return (
    <div className="card">
      <h2>Score per criterion</h2>
      <p className="muted small">
        Hover or focus a cell for the metric value, calculated score and rating. Blend: {fmtPct(blend)} calculated, {fmtPct(1 - blend)} rating.
      </p>
      <div className="table-wrap">
        <table className="heat">
          <thead>
            <tr>
              <th>Model</th>
              {criteria.map((c) => (
                <th key={c.id} className="num" style={{ textAlign: 'center' }}>
                  {c.name}
                  <div className="small" style={{ fontWeight: 400 }}>
                    {totalW > 0 ? fmtPct(Math.max(0, c.weight) / totalW) : '–'}
                  </div>
                </th>
              ))}
              <th className="num" style={{ textAlign: 'center' }}>
                Weighted total
              </th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((r) => (
              <tr key={r.model.id}>
                <td className="nowrap">
                  <span className="swatch" style={{ background: r.model.colour }} />
                  {r.model.name}
                </td>
                {criteria.map((c, i) => {
                  const s = r.score.scores[i];
                  if (!s) return <td key={c.id} />;
                  const col = scoreColours(s.final, dark);
                  const unit = METRIC_BY_KEY.get(c.metric)?.unit ?? '';
                  const tip = [
                    c.metric === 'manual' ? 'Metric: rating only' : `Metric: ${fmtMetric(s.metricValue, unit)}`,
                    `Calculated score: ${s.calculated === null ? '–' : fmtNum(s.calculated, 2)}`,
                    `Rating: ${s.rating === null ? 'none' : `${s.rating} of 5 (score ${fmtNum(s.ratingScore, 2)})`}`,
                    `Final score: ${fmtNum(s.final, 2)}`,
                  ];
                  return (
                    <td
                      key={c.id}
                      className="score"
                      style={{ background: col.bg, color: col.fg, position: 'relative' }}
                      tabIndex={0}
                      aria-label={`${r.model.name}, ${c.name}. ${tip.join('. ')}`}
                    >
                      {fmtNum(s.final, 1)}
                      <span className="cell-tip" role="tooltip">
                        <strong>
                          {r.model.name} · {c.name}
                        </strong>
                        {tip.map((t) => (
                          <span key={t}>{t}</span>
                        ))}
                      </span>
                    </td>
                  );
                })}
                <td className="score" style={{ ...cellStyle(r.score.total, dark) }}>
                  {fmtNum(r.score.total, 2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function cellStyle(score: number, dark: boolean): React.CSSProperties {
  const c = scoreColours(score, dark);
  return { background: c.bg, color: c.fg };
}

const tooltipStyle = {
  contentStyle: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12, color: 'var(--text)' },
  labelStyle: { color: 'var(--text)', fontWeight: 600 },
  itemStyle: { color: 'var(--text)' },
};

function RadarCard({ rows, criteria }: { rows: Row[]; criteria: Criterion[] }) {
  const data = criteria.map((c, i) => {
    const point: Record<string, string | number> = { criterion: c.name.length > 18 ? `${c.name.slice(0, 16)}…` : c.name };
    for (const r of rows) point[r.model.id] = Number((r.score.scores[i]?.final ?? 0).toFixed(2));
    return point;
  });
  return (
    <div className="card">
      <h2>Score profile</h2>
      <div className="chart-box" style={{ height: 360 }}>
        <ResponsiveContainer>
          <RadarChart data={data} outerRadius="62%" margin={{ top: 8, right: 40, bottom: 8, left: 40 }}>
            <PolarGrid />
            <PolarAngleAxis dataKey="criterion" tick={{ fontSize: 11 }} />
            <PolarRadiusAxis domain={[0, 10]} tickCount={3} tick={false} axisLine={false} />
            {rows.map((r) => (
              <Radar
                key={r.model.id}
                name={r.model.name}
                dataKey={r.model.id}
                stroke={r.model.colour}
                strokeWidth={2}
                fill={r.model.colour}
                fillOpacity={0.06}
                dot={{ r: 3 }}
                isAnimationActive={false}
              />
            ))}
            <Tooltip {...tooltipStyle} formatter={(v: number) => fmtNum(v, 1)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const COST_SERIES = [
  { key: 'linehaul', label: 'Linehaul' },
  { key: 'dcHandling', label: 'DC handling' },
  { key: 'hubHandling', label: 'Hub handling' },
  { key: 'buildings', label: 'Buildings' },
  { key: 'inventory', label: 'Inventory carrying' },
  { key: 'lastMile', label: 'Last mile' },
  { key: 'adminStaff', label: 'Admin, systems and staffing' },
] as const;

function CostBars({ rows }: { rows: Row[] }) {
  const data = rows.map((r) => {
    const b = r.result.breakdown;
    return {
      name: r.model.name,
      linehaul: b.linehaul,
      dcHandling: b.dcHandling,
      hubHandling: b.hubHandling,
      buildings: b.buildings,
      inventory: b.inventory,
      lastMile: b.lastMile,
      adminStaff: b.admin + b.systems + b.extraStaff,
    };
  });
  return (
    <div className="card">
      <h2>Annual cost by component</h2>
      <div className="chart-box" style={{ height: 360 }}>
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }} barCategoryGap="28%">
            <CartesianGrid horizontal={false} />
            <XAxis type="number" tickFormatter={(v: number) => fmtEurShort(v)} tick={{ fontSize: 11 }} />
            <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11 }} />
            <Tooltip {...tooltipStyle} formatter={(v: number) => fmtEur(v)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {COST_SERIES.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stackId="cost"
                fill={CATEGORICAL[i]}
                isAnimationActive={false}
                radius={i === COST_SERIES.length - 1 ? [0, 4, 4, 0] : undefined}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

interface FigureRow {
  label: string;
  get: (r: Row) => number | null;
  format: (n: number | null) => string;
  /** null: no better or worse direction. */
  lowerIsBetter: boolean | null;
}

const FIGURES: FigureRow[] = [
  { label: 'Total cost (€/year)', get: (r) => r.result.totalCost, format: (n) => fmtEur(n), lowerIsBetter: true },
  { label: 'Cost per unit (€)', get: (r) => r.result.costPerUnit, format: (n) => fmtEur(n, 3), lowerIsBetter: true },
  { label: 'Units per year', get: (r) => r.result.units, format: (n) => fmtNum(n), lowerIsBetter: null },
  { label: 'Linehaul (€/year)', get: (r) => r.result.breakdown.linehaul, format: (n) => fmtEur(n), lowerIsBetter: true },
  { label: 'DC handling (€/year)', get: (r) => r.result.breakdown.dcHandling, format: (n) => fmtEur(n), lowerIsBetter: true },
  { label: 'Hub handling (€/year)', get: (r) => r.result.breakdown.hubHandling, format: (n) => fmtEur(n), lowerIsBetter: true },
  { label: 'Buildings (€/year)', get: (r) => r.result.breakdown.buildings, format: (n) => fmtEur(n), lowerIsBetter: true },
  { label: 'Inventory carrying (€/year)', get: (r) => r.result.breakdown.inventory, format: (n) => fmtEur(n), lowerIsBetter: true },
  { label: 'Last mile (€/year)', get: (r) => r.result.breakdown.lastMile, format: (n) => fmtEur(n), lowerIsBetter: true },
  {
    label: 'Admin, systems and staffing (€/year)',
    get: (r) => r.result.breakdown.admin + r.result.breakdown.systems + r.result.breakdown.extraStaff,
    format: (n) => fmtEur(n),
    lowerIsBetter: true,
  },
  { label: 'Own FTE', get: (r) => r.result.ownFte, format: (n) => fmtNum(n, 1), lowerIsBetter: true },
  { label: 'Sites (DC plus hubs)', get: (r) => r.result.sites, format: (n) => fmtNum(n), lowerIsBetter: null },
  { label: 'Floor space (m²)', get: (r) => r.result.floorM2, format: (n) => fmtNum(n), lowerIsBetter: true },
  { label: 'Truck km per year', get: (r) => r.result.truckKm, format: (n) => fmtNum(n), lowerIsBetter: true },
  { label: 'Van km per year', get: (r) => r.result.vanKm, format: (n) => fmtNum(n), lowerIsBetter: true },
  { label: 'CO2 (t/year)', get: (r) => r.result.co2Kg / 1000, format: (n) => fmtNum(n, 0), lowerIsBetter: true },
  { label: 'CO2 per 1,000 units (kg)', get: (r) => r.result.metrics.co2Per1000Units, format: (n) => fmtNum(n, 1), lowerIsBetter: true },
  { label: 'Variable cost share', get: (r) => r.result.variableShare, format: (n) => fmtPct(n, 1), lowerIsBetter: false },
  { label: 'Capacity use', get: (r) => r.result.capacityUse, format: (n) => (n === null ? 'No limit' : fmtPct(n, 0)), lowerIsBetter: null },
  { label: 'Cost per extra unit at +50% (€)', get: (r) => r.result.growth.costPerExtraUnit, format: (n) => fmtEur(n, 3), lowerIsBetter: true },
  { label: 'Notice period (weeks)', get: (r) => r.model.contract.noticeWeeks, format: (n) => fmtNum(n), lowerIsBetter: true },
  { label: 'Setup time (weeks)', get: (r) => r.model.contract.setupWeeks, format: (n) => fmtNum(n), lowerIsBetter: true },
];

function KeyFigures({ rows, baseline }: { rows: Row[]; baseline: Row | undefined }) {
  return (
    <div className="card">
      <h2>Key figures</h2>
      <p className="muted small">Each cell shows the value and the change versus the baseline. ▼ and ▲ mark the direction; green is better, red is worse.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Figure</th>
              {rows.map((r) => (
                <th key={r.model.id} className="num">
                  <span className="swatch" style={{ background: r.model.colour }} />
                  {r.model.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FIGURES.map((f) => (
              <tr key={f.label}>
                <td className="nowrap">{f.label}</td>
                {rows.map((r) => {
                  const v = f.get(r);
                  const isBase = baseline?.model.id === r.model.id;
                  return (
                    <td key={r.model.id} className="num">
                      <div>{f.format(v)}</div>
                      <div className="small">
                        {isBase ? <span className="muted">Baseline</span> : <Delta value={v} base={baseline ? f.get(baseline) : null} lowerIsBetter={f.lowerIsBetter} />}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MapsCard({ rows }: { rows: Row[] }) {
  const dc = useApp((s) => s.ws.dc);
  const hubs = useApp((s) => s.ws.hubs);
  const stores = useStores();
  const a = useAssumptionValues();
  return (
    <div className="card">
      <h2>Network per model</h2>
      <div className="maps-grid">
        {rows.map((r) => (
          <div key={r.model.id}>
            <h3>
              <span className="swatch" style={{ background: r.model.colour }} />
              {r.model.name}
            </h3>
            <NetworkMap
              dc={dc}
              hubs={hubs}
              stores={stores}
              roadFactor={a.roadFactor}
              openHubIds={r.model.openHubIds}
              hubRole={r.model.hubRole}
              size="small"
              label={`Network map for ${r.model.name}`}
            />
            <p className="small muted" style={{ marginTop: 4 }}>
              {HUB_ROLE_LABELS[r.model.hubRole]} · {r.model.hubRole === 'none' ? 'no hubs' : `${r.result.sites - 1} hubs`} ·{' '}
              {r.model.hubOperator === '3pl' ? '3PL' : 'own staff'} · {r.model.lastMile === 'carrier' ? 'carrier' : 'own vans'}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Points({ ranked, criteria }: { ranked: Row[]; criteria: Criterion[] }) {
  return (
    <div className="card">
      <h2>Strong and weak points</h2>
      <div className="points">
        {ranked.map((r) => {
          const scored = criteria
            .map((c, i) => ({ c, s: r.score.scores[i]?.final ?? 0 }))
            .sort((a, b) => b.s - a.s);
          const best = scored.slice(0, 2);
          const worst = scored.slice(-2).reverse();
          return (
            <div key={r.model.id} className="card" style={{ marginBottom: 0 }}>
              <h3>
                <span className="swatch" style={{ background: r.model.colour }} />
                {r.score.rank}. {r.model.name}
              </h3>
              <div className="small muted">Scores best on</div>
              <ul className="small">
                {best.map((x) => (
                  <li key={x.c.id}>
                    {x.c.name} ({fmtNum(x.s, 1)})
                  </li>
                ))}
              </ul>
              <div className="small muted">Scores worst on</div>
              <ul className="small">
                {worst.map((x) => (
                  <li key={x.c.id}>
                    {x.c.name} ({fmtNum(x.s, 1)})
                  </li>
                ))}
              </ul>
              {r.model.strengths.filter(Boolean).length > 0 && (
                <>
                  <div className="small muted">Strengths</div>
                  <ul className="small">
                    {r.model.strengths.filter(Boolean).map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </>
              )}
              {r.model.weaknesses.filter(Boolean).length > 0 && (
                <>
                  <div className="small muted">Weaknesses</div>
                  <ul className="small">
                    {r.model.weaknesses.filter(Boolean).map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </>
              )}
              {r.model.customParams.length > 0 && (
                <>
                  <div className="small muted">Custom parameters</div>
                  <ul className="small">
                    {r.model.customParams.map((p) => (
                      <li key={p.id}>
                        {p.key}: {p.value} {p.unit}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {r.result.warnings.map((w) => (
                <p key={w} className="small error-text">
                  {w}
                </p>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
