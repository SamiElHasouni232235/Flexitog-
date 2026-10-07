import { useMemo, useState } from 'react';
import { ASSUMPTION_GROUPS } from '../data/seed';
import { blankModel, fromTemplate, modelTemplates, uid } from '../data/templates';
import { evaluateModel } from '../engine/model';
import { assignStores, servingNodes } from '../engine/stores';
import type { AssumptionKey, HubOperator, HubRole, LastMileMode, LinehaulMode, Model, ModelTag } from '../engine/types';
import { useApp, useAssumptionValues, useStores } from '../state/store';
import { DataFlag, DummyBadge } from '../ui/DataFlag';
import { fmtEur, fmtNum } from '../ui/format';
import { hubColour } from '../ui/hubColours';
import { NetworkMap } from '../ui/NetworkMap';
import { Field, NumberInput } from '../ui/NumberInput';
import { ConfirmButton } from '../ui/ConfirmButton';

const TAGS: ModelTag[] = ['network', '3PL', 'staffing', 'transport', 'other'];

export const HUB_ROLE_LABELS: Record<HubRole, string> = {
  stock: 'Hubs hold stock and pick',
  'cross-dock': 'Cross-dock hubs, DC picks',
  none: 'No hubs, ship from DC',
};

export function ModelsPage() {
  const models = useApp((s) => s.ws.models);
  const baselineId = useApp((s) => s.ws.settings.baselineModelId);
  const hubs = useApp((s) => s.ws.hubs);
  const { addModel, removeModel, updateSettings } = useApp.getState();
  const [selectedId, setSelectedId] = useState(models[0]?.id ?? '');
  const [templateIdx, setTemplateIdx] = useState(0);
  const templates = useMemo(() => modelTemplates(), []);
  const model = models.find((m) => m.id === selectedId) ?? models[0];
  const colours = models.map((m) => m.colour);

  const add = (m: Model) => {
    addModel(m);
    setSelectedId(m.id);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Model builder</h1>
          <p>Define each alternative way of working. Every model runs on the same scenario and is compared with the baseline.</p>
        </div>
      </div>
      <div className="builder">
        <div>
          <div className="card">
            <h3>Models</h3>
            <ul className="model-list">
              {models.map((m) => (
                <li key={m.id}>
                  <button aria-current={m.id === model?.id} onClick={() => setSelectedId(m.id)}>
                    <span className="swatch" style={{ background: m.colour }} />
                    <span className="name">
                      {m.name}
                      {m.id === baselineId && <span className="badge neutral" style={{ marginLeft: 4 }}>Baseline</span>}
                    </span>
                    <DummyBadge show={m.isDummy} />
                  </button>
                </li>
              ))}
            </ul>
            {models.length === 0 && <p className="muted">No models yet.</p>}
            <div className="stack" style={{ marginTop: 8 }}>
              <button className="primary" onClick={() => add(blankModel(hubs.map((h) => h.id), colours))}>
                New model
              </button>
              <button
                disabled={!model}
                onClick={() => model && add({ ...structuredClone(model), id: uid('model'), name: `${model.name} (copy)` })}
              >
                Duplicate
              </button>
              <ConfirmButton
                className="danger"
                disabled={!model}
                confirmLabel="Delete model"
                onConfirm={() => {
                  if (!model) return;
                  removeModel(model.id);
                  setSelectedId(models.find((m) => m.id !== model.id)?.id ?? '');
                }}
              >
                Delete
              </ConfirmButton>
            </div>
          </div>
          <div className="card">
            <h3>Start from template</h3>
            <div className="stack">
              <select value={templateIdx} onChange={(e) => setTemplateIdx(Number(e.target.value))} aria-label="Template">
                {templates.map((t, i) => (
                  <option key={t.id} value={i}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => {
                  const t = templates[templateIdx];
                  if (t) add(fromTemplate(t, colours));
                }}
              >
                Create from template
              </button>
            </div>
          </div>
          {model && (
            <div className="card">
              <button disabled={model.id === baselineId} onClick={() => updateSettings({ baselineModelId: model.id })}>
                Set as baseline
              </button>
              <p className="muted small" style={{ marginTop: 6 }}>
                Results show the change of every model versus the baseline.
              </p>
            </div>
          )}
        </div>
        <div>{model ? <ModelEditor key={model.id} model={model} /> : <div className="card">Create a model to start.</div>}</div>
      </div>
    </>
  );
}

function ModelEditor({ model }: { model: Model }) {
  const update = (patch: Partial<Model>) => useApp.getState().updateModel(model.id, patch);
  const hubs = useApp((s) => s.ws.hubs);
  const dc = useApp((s) => s.ws.dc);
  const products = useApp((s) => s.ws.products);
  const assumptions = useApp((s) => s.ws.assumptions);
  const criteria = useApp((s) => s.ws.criteria);
  const scenarios = useApp((s) => s.ws.scenarios);
  const selectedScenarioId = useApp((s) => s.ws.settings.selectedScenarioId);
  const stores = useStores();
  const a = useAssumptionValues();
  const scenario = scenarios.find((s) => s.id === selectedScenarioId) ?? scenarios[0];

  const quick = useMemo(
    () => (scenario ? evaluateModel({ products, dc, hubs, stores, assumptions }, model, scenario) : null),
    [products, dc, hubs, stores, assumptions, model, scenario],
  );

  const storesPerNode = useMemo(() => {
    const nodes = servingNodes(model.hubRole, model.openHubIds, hubs, dc);
    const counts = new Map<string, number>();
    for (const x of assignStores(stores, nodes, a.roadFactor)) counts.set(x.nodeId, (counts.get(x.nodeId) ?? 0) + 1);
    return nodes.map((n) => ({ node: n, count: counts.get(n.id) ?? 0 }));
  }, [model.hubRole, model.openHubIds, hubs, dc, stores, a.roadFactor]);

  const ops = model.operations;
  const contract = model.contract;
  const admin = model.admin;

  return (
    <>
      <div className="card">
        <div className="page-head" style={{ marginBottom: 6 }}>
          <h2>
            <span className="swatch" style={{ background: model.colour }} />
            {model.name} <DummyBadge show={model.isDummy} />
          </h2>
          <DataFlag isDummy={model.isDummy} onChange={(isDummy) => update({ isDummy })} label={model.name} />
        </div>
        {quick && scenario && (
          <p className="small muted" style={{ margin: 0 }}>
            Quick check on {scenario.name}: total cost <strong>{fmtEur(quick.totalCost)}</strong>, cost per unit{' '}
            <strong>{fmtEur(quick.costPerUnit, 3)}</strong>, own FTE <strong>{fmtNum(quick.ownFte, 1)}</strong>, CO2{' '}
            <strong>{fmtNum(quick.co2Kg / 1000, 0)} t</strong>.
            {quick.warnings.map((w) => (
              <span key={w} className="error-text">
                {' '}
                {w}
              </span>
            ))}
          </p>
        )}
      </div>

      <details className="section" open>
        <summary>Description</summary>
        <div className="content stack">
          <div className="fields">
            <Field label="Name">
              <input value={model.name} onChange={(e) => update({ name: e.target.value })} />
            </Field>
            <Field label="Colour">
              <input type="color" value={model.colour} onChange={(e) => update({ colour: e.target.value })} />
            </Field>
          </div>
          <Field label="Description">
            <textarea rows={3} style={{ fontFamily: 'inherit' }} value={model.description} onChange={(e) => update({ description: e.target.value })} />
          </Field>
          <div className="chips" role="group" aria-label="Tags">
            <span className="muted small">Tags:</span>
            {TAGS.map((t) => (
              <label key={t} className="check small">
                <input
                  type="checkbox"
                  checked={model.tags.includes(t)}
                  onChange={(e) => update({ tags: e.target.checked ? [...model.tags, t] : model.tags.filter((x) => x !== t) })}
                />
                {t}
              </label>
            ))}
          </div>
        </div>
      </details>

      <details className="section">
        <summary>Strengths and weaknesses</summary>
        <div className="content grid-2">
          <ListEditor label="Strengths" items={model.strengths} onChange={(strengths) => update({ strengths })} />
          <ListEditor label="Weaknesses" items={model.weaknesses} onChange={(weaknesses) => update({ weaknesses })} />
        </div>
      </details>

      <details className="section" open>
        <summary>Network</summary>
        <div className="content">
          <div className="grid-2">
            <div className="stack">
              <fieldset className="stack" style={{ border: 'none', padding: 0, margin: 0 }}>
                <legend className="muted small">Hub role</legend>
                {(Object.keys(HUB_ROLE_LABELS) as HubRole[]).map((r) => (
                  <label key={r} className="check">
                    <input type="radio" name="hubRole" checked={model.hubRole === r} onChange={() => update({ hubRole: r })} />
                    {HUB_ROLE_LABELS[r]}
                  </label>
                ))}
              </fieldset>
              <fieldset className="stack" style={{ border: 'none', padding: 0, margin: 0 }} disabled={model.hubRole === 'none'}>
                <legend className="muted small">Open hubs. Stores of a closed hub move to the nearest open hub.</legend>
                {hubs.map((h, i) => (
                  <label key={h.id} className="check">
                    <input
                      type="checkbox"
                      checked={model.openHubIds.includes(h.id)}
                      onChange={(e) =>
                        update({ openHubIds: e.target.checked ? [...model.openHubIds, h.id] : model.openHubIds.filter((x) => x !== h.id) })
                      }
                    />
                    <span className="swatch" style={{ background: hubColour(i) }} />
                    {h.name} ({h.country})
                  </label>
                ))}
              </fieldset>
              <div className="fields">
                <Field label="Hub operator">
                  <select value={model.hubOperator} onChange={(e) => update({ hubOperator: e.target.value as HubOperator })} disabled={model.hubRole === 'none'}>
                    <option value="own">Own staff</option>
                    <option value="3pl">3PL</option>
                  </select>
                </Field>
                <Field label="Linehaul DC to hub">
                  <select value={model.linehaul} onChange={(e) => update({ linehaul: e.target.value as LinehaulMode })} disabled={model.hubRole === 'none'}>
                    <option value="ftl">Full truck</option>
                    <option value="groupage">Groupage per pallet</option>
                  </select>
                </Field>
                <Field label="Last mile">
                  <select value={model.lastMile} onChange={(e) => update({ lastMile: e.target.value as LastMileMode })}>
                    <option value="own-vans">Own vans</option>
                    <option value="carrier">Carrier per stop</option>
                  </select>
                </Field>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Serving node</th>
                      <th className="num">Stores served</th>
                    </tr>
                  </thead>
                  <tbody>
                    {storesPerNode.map((x) => (
                      <tr key={x.node.id}>
                        <td>{x.node.kind === 'dc' ? `${x.node.name} (DC)` : x.node.name}</td>
                        <td className="num">{fmtNum(x.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <NetworkMap
                dc={dc}
                hubs={hubs}
                stores={stores}
                roadFactor={a.roadFactor}
                openHubIds={model.openHubIds}
                hubRole={model.hubRole}
                size="small"
                label={`Network map for ${model.name}`}
              />
              <p className="muted small" style={{ marginTop: 4 }}>
                Store colour shows the serving node. Grey dashed circles are closed hubs.
              </p>
            </div>
          </div>
        </div>
      </details>

      <details className="section" open>
        <summary>Operations</summary>
        <div className="content fields">
          <Field label="Pick rate" hint="lines/hour">
            <NumberInput value={ops.pickRateLinesPerHour} min={1} onChange={(v) => update({ operations: { ...ops, pickRateLinesPerHour: v } })} />
          </Field>
          <Field label="Stock days at hub" hint="working days">
            <NumberInput value={ops.stockDaysAtHub} min={0} onChange={(v) => update({ operations: { ...ops, stockDaysAtHub: v } })} />
          </Field>
          <Field label="Stops per van route">
            <NumberInput value={ops.stopsPerVanRoute} min={1} onChange={(v) => update({ operations: { ...ops, stopsPerVanRoute: v } })} />
          </Field>
          <Field label="Extra DC floor space" hint="m²">
            <NumberInput value={ops.extraDcFloorM2} min={0} step={100} onChange={(v) => update({ operations: { ...ops, extraDcFloorM2: v } })} />
          </Field>
        </div>
      </details>

      <details className="section">
        <summary>Contract and capacity</summary>
        <div className="content fields">
          <Field label="Notice period" hint="weeks">
            <NumberInput value={contract.noticeWeeks} min={0} onChange={(v) => update({ contract: { ...contract, noticeWeeks: v } })} />
          </Field>
          <Field label="Capacity" hint="units/year, 0 = no limit">
            <NumberInput
              value={contract.capacityUnitsPerYear}
              min={0}
              step={100000}
              onChange={(v) => update({ contract: { ...contract, capacityUnitsPerYear: v } })}
            />
          </Field>
          <Field label="Setup time" hint="weeks">
            <NumberInput value={contract.setupWeeks} min={0} onChange={(v) => update({ contract: { ...contract, setupWeeks: v } })} />
          </Field>
        </div>
      </details>

      <details className="section">
        <summary>Administration and staffing</summary>
        <div className="content stack">
          <div className="fields">
            <Field label="Admin FTE base">
              <NumberInput value={admin.adminFteBase} min={0} step={0.5} onChange={(v) => update({ admin: { ...admin, adminFteBase: v } })} />
            </Field>
            <Field label="Admin FTE per hub">
              <NumberInput value={admin.adminFtePerHub} min={0} step={0.1} onChange={(v) => update({ admin: { ...admin, adminFtePerHub: v } })} />
            </Field>
            <Field label="Systems cost" hint="€/year">
              <NumberInput
                value={admin.systemsCostPerYear}
                min={0}
                step={5000}
                onChange={(v) => update({ admin: { ...admin, systemsCostPerYear: v } })}
              />
            </Field>
          </div>
          <h4 style={{ margin: '8px 0 0' }}>Extra staffing</h4>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Role</th>
                  <th className="num">FTE</th>
                  <th className="num">Annual cost per FTE (€)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {model.extraStaff.map((x) => {
                  const set = (patch: Partial<typeof x>) =>
                    update({ extraStaff: model.extraStaff.map((y) => (y.id === x.id ? { ...y, ...patch } : y)) });
                  return (
                    <tr key={x.id}>
                      <td>
                        <input value={x.role} onChange={(e) => set({ role: e.target.value })} aria-label="Role" />
                      </td>
                      <td>
                        <NumberInput value={x.fte} min={0} step={0.5} onChange={(fte) => set({ fte })} label="FTE" />
                      </td>
                      <td>
                        <NumberInput value={x.annualCostPerFte} min={0} step={1000} onChange={(annualCostPerFte) => set({ annualCostPerFte })} label="Annual cost" />
                      </td>
                      <td>
                        <button className="link" onClick={() => update({ extraStaff: model.extraStaff.filter((y) => y.id !== x.id) })}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {model.extraStaff.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      No extra staff.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div>
            <button
              onClick={() =>
                update({ extraStaff: [...model.extraStaff, { id: uid('xs'), role: 'New role', fte: 1, annualCostPerFte: 55000 }] })
              }
            >
              Add staff
            </button>
          </div>
        </div>
      </details>

      <details className="section">
        <summary>Cost overrides ({Object.keys(model.costOverrides).length})</summary>
        <div className="content">
          <CostOverrides model={model} onChange={(costOverrides) => update({ costOverrides })} />
        </div>
      </details>

      <details className="section">
        <summary>Custom parameters ({model.customParams.length})</summary>
        <div className="content stack">
          <p className="muted small">Free fields to record extra facts about the model. They show in results but do not change the calculation.</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Value</th>
                  <th>Unit</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {model.customParams.map((p) => {
                  const set = (patch: Partial<typeof p>) =>
                    update({ customParams: model.customParams.map((y) => (y.id === p.id ? { ...y, ...patch } : y)) });
                  return (
                    <tr key={p.id}>
                      <td>
                        <input value={p.key} onChange={(e) => set({ key: e.target.value })} aria-label="Key" />
                      </td>
                      <td>
                        <input value={p.value} onChange={(e) => set({ value: e.target.value })} aria-label="Value" />
                      </td>
                      <td>
                        <input value={p.unit} onChange={(e) => set({ unit: e.target.value })} aria-label="Unit" />
                      </td>
                      <td>
                        <button className="link" onClick={() => update({ customParams: model.customParams.filter((y) => y.id !== p.id) })}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div>
            <button onClick={() => update({ customParams: [...model.customParams, { id: uid('cp'), key: 'New parameter', value: '', unit: '' }] })}>
              Add parameter
            </button>
          </div>
        </div>
      </details>

      <details className="section" open>
        <summary>Ratings</summary>
        <div className="content">
          <p className="muted small">Rate 1 (poor) to 5 (strong) for factors the numbers miss. Ratings blend with the calculated scores.</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Criterion</th>
                  {[1, 2, 3, 4, 5].map((r) => (
                    <th key={r} className="num">
                      {r}
                    </th>
                  ))}
                  <th>None</th>
                </tr>
              </thead>
              <tbody>
                {criteria.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {c.name}
                      {c.metric === 'manual' && <span className="badge neutral" style={{ marginLeft: 4 }}>Rating only</span>}
                    </td>
                    {[1, 2, 3, 4, 5].map((r) => (
                      <td key={r} className="num">
                        <input
                          type="radio"
                          name={`rating-${c.id}`}
                          aria-label={`${c.name} rating ${r}`}
                          checked={model.ratings[c.id] === r}
                          onChange={() => update({ ratings: { ...model.ratings, [c.id]: r } })}
                        />
                      </td>
                    ))}
                    <td>
                      <input
                        type="radio"
                        name={`rating-${c.id}`}
                        aria-label={`${c.name} no rating`}
                        checked={model.ratings[c.id] === undefined}
                        onChange={() => {
                          const { [c.id]: _removed, ...rest } = model.ratings;
                          void _removed;
                          update({ ratings: rest });
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </>
  );
}

function ListEditor({ label, items, onChange }: { label: string; items: string[]; onChange: (items: string[]) => void }) {
  return (
    <div className="stack">
      <h4 style={{ margin: 0 }}>{label}</h4>
      {items.map((item, i) => (
        <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
          <input
            style={{ flex: 1 }}
            value={item}
            aria-label={`${label} ${i + 1}`}
            onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <button className="link" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`Remove ${label} ${i + 1}`}>
            Remove
          </button>
        </div>
      ))}
      <div>
        <button onClick={() => onChange([...items, ''])}>Add</button>
      </div>
    </div>
  );
}

function CostOverrides({ model, onChange }: { model: Model; onChange: (o: Model['costOverrides']) => void }) {
  const assumptions = useApp((s) => s.ws.assumptions);
  const [pick, setPick] = useState<AssumptionKey | ''>('');
  const overrides = model.costOverrides;
  const keys = Object.keys(overrides) as AssumptionKey[];
  const available = assumptions.filter((a) => !(a.key in overrides));
  return (
    <div className="stack">
      <p className="muted small">Replace a shared cost assumption for this model only. Other models keep the shared value.</p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Assumption</th>
              <th>Unit</th>
              <th className="num">Shared value</th>
              <th className="num">This model</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => {
              const a = assumptions.find((x) => x.key === k);
              return (
                <tr key={k}>
                  <td>{a?.label ?? k}</td>
                  <td className="muted">{a?.unit}</td>
                  <td className="num">{fmtNum(a?.value, 2)}</td>
                  <td style={{ width: 130 }}>
                    <NumberInput value={overrides[k] ?? 0} onChange={(v) => onChange({ ...overrides, [k]: v })} label={`${a?.label ?? k} override`} />
                  </td>
                  <td>
                    <button
                      className="link"
                      onClick={() => {
                        const { [k]: _removed, ...rest } = overrides;
                        void _removed;
                        onChange(rest);
                      }}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
            {keys.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  No overrides. The model uses the shared assumptions.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="row">
        <select value={pick} onChange={(e) => setPick(e.target.value as AssumptionKey)} aria-label="Assumption to override">
          <option value="">Choose an assumption</option>
          {ASSUMPTION_GROUPS.map((g) => (
            <optgroup key={g} label={g}>
              {available
                .filter((a) => a.group === g)
                .map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.label} ({a.unit})
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
        <button
          disabled={!pick}
          onClick={() => {
            if (!pick) return;
            const shared = assumptions.find((a) => a.key === pick)?.value ?? 0;
            onChange({ ...overrides, [pick]: shared });
            setPick('');
          }}
        >
          Add override
        </button>
      </div>
    </div>
  );
}
