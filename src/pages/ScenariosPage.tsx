import { useMemo, useState } from 'react';
import { blankScenario, uid } from '../data/templates';
import { parseOrderLinesCsv } from '../engine/csv';
import { storeDemands } from '../engine/demand';
import { summariseTestOrder } from '../engine/products';
import type { OrderLine, Scenario, ScenarioType } from '../engine/types';
import { useApp, useAssumptionValues, useStores } from '../state/store';
import { DataFlag, DummyBadge } from '../ui/DataFlag';
import { fmtNum } from '../ui/format';
import { Field, NumberInput } from '../ui/NumberInput';
import { ConfirmButton } from '../ui/ConfirmButton';

export const SCENARIO_TYPES: Array<{ value: ScenarioType; label: string }> = [
  { value: 'test-order', label: 'Test order' },
  { value: 'forecast', label: 'Forecast' },
  { value: 'target', label: 'Target' },
  { value: 'baseline', label: 'Baseline' },
];

export function ScenariosPage() {
  const scenarios = useApp((s) => s.ws.scenarios);
  const { addScenario, removeScenario } = useApp.getState();
  const [selectedId, setSelectedId] = useState(scenarios[0]?.id ?? '');
  const scenario = scenarios.find((s) => s.id === selectedId) ?? scenarios[0];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Scenarios</h1>
          <p>A scenario is the demand every model runs on: a volume target or a test order scaled to a year.</p>
        </div>
        <div className="row">
          <button
            onClick={() => {
              const s = blankScenario('volume');
              addScenario(s);
              setSelectedId(s.id);
            }}
          >
            New volume scenario
          </button>
          <button
            onClick={() => {
              const s = blankScenario('test-order');
              addScenario(s);
              setSelectedId(s.id);
            }}
          >
            New test order
          </button>
        </div>
      </div>

      <div className="builder">
        <div className="card">
          <h3>Scenarios</h3>
          <ul className="model-list">
            {scenarios.map((s) => (
              <li key={s.id}>
                <button aria-current={s.id === scenario?.id} onClick={() => setSelectedId(s.id)}>
                  <span className="name">{s.name}</span>
                  <DummyBadge show={s.isDummy} />
                </button>
              </li>
            ))}
          </ul>
          {scenarios.length === 0 && <p className="muted">No scenarios yet.</p>}
        </div>
        <div>
          {scenario ? (
            <ScenarioEditor
              key={scenario.id}
              scenario={scenario}
              onDuplicate={() => {
                const copy = { ...structuredClone(scenario), id: uid('scn'), name: `${scenario.name} (copy)` };
                addScenario(copy);
                setSelectedId(copy.id);
              }}
              onDelete={() => {
                removeScenario(scenario.id);
                setSelectedId(scenarios.find((s) => s.id !== scenario.id)?.id ?? '');
              }}
            />
          ) : (
            <div className="card">Create a scenario to start.</div>
          )}
        </div>
      </div>
    </>
  );
}

function ScenarioEditor({ scenario, onDuplicate, onDelete }: { scenario: Scenario; onDuplicate: () => void; onDelete: () => void }) {
  const update = (patch: Partial<Scenario>) => useApp.getState().updateScenario(scenario.id, patch);
  return (
    <>
      <div className="card">
        <div className="page-head" style={{ marginBottom: 8 }}>
          <h2>
            {scenario.name} <DummyBadge show={scenario.isDummy} />
          </h2>
          <div className="row">
            <button onClick={onDuplicate}>Duplicate</button>
            <ConfirmButton className="danger" confirmLabel="Delete scenario" onConfirm={onDelete}>
              Delete
            </ConfirmButton>
          </div>
        </div>
        <div className="fields">
          <Field label="Name">
            <input value={scenario.name} onChange={(e) => update({ name: e.target.value })} />
          </Field>
          <Field label="Type">
            <select value={scenario.type} onChange={(e) => update({ type: e.target.value as ScenarioType })}>
              {SCENARIO_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Input mode">
            <select value={scenario.mode} onChange={(e) => update({ mode: e.target.value as Scenario['mode'] })}>
              <option value="volume">Mode A, volume</option>
              <option value="test-order">Mode B, test order</option>
            </select>
          </Field>
        </div>
        <div style={{ marginTop: 8 }}>
          <DataFlag isDummy={scenario.isDummy} onChange={(isDummy) => update({ isDummy })} label={scenario.name} />
        </div>
      </div>
      {scenario.mode === 'volume' ? <VolumeEditor scenario={scenario} /> : <TestOrderEditor scenario={scenario} />}
    </>
  );
}

function VolumeEditor({ scenario }: { scenario: Scenario }) {
  const v = scenario.volume;
  const update = (patch: Partial<Scenario['volume']>) =>
    useApp.getState().updateScenario(scenario.id, { volume: { ...v, ...patch } });
  const products = useApp((s) => s.ws.products);
  const hubs = useApp((s) => s.ws.hubs);
  const stores = useStores();
  const a = useAssumptionValues();
  const totals = useMemo(() => {
    const d = storeDemands(scenario, stores, products, hubs, a.weeksPerYear);
    return {
      units: d.reduce((s, x) => s + x.units, 0),
      orders: d.reduce((s, x) => s + x.orders, 0),
      lines: d.reduce((s, x) => s + x.lines, 0),
      cartons: d.reduce((s, x) => s + x.cartons, 0),
      pallets: d.reduce((s, x) => s + x.pallets, 0),
      stores: d.reduce((s, x) => s + x.storeCount, 0),
    };
  }, [scenario, stores, products, hubs, a.weeksPerYear]);

  return (
    <div className="card">
      <h3>Volume input</h3>
      <div className="fields">
        <Field label="Annual units" hint="units/year">
          <NumberInput value={v.annualUnits} min={0} step={10000} onChange={(annualUnits) => update({ annualUnits })} />
        </Field>
        <Field label="Store growth factor" hint="1.2 = 20% more stores">
          <NumberInput value={v.storeGrowthFactor} min={0} step={0.05} onChange={(storeGrowthFactor) => update({ storeGrowthFactor })} />
        </Field>
        <Field label="Deliveries per store per week">
          <NumberInput
            value={v.deliveriesPerStorePerWeek}
            min={0}
            step={0.5}
            onChange={(deliveriesPerStorePerWeek) => update({ deliveriesPerStorePerWeek })}
          />
        </Field>
        <Field label="Lines per order">
          <NumberInput value={v.linesPerOrder} min={0} step={1} onChange={(linesPerOrder) => update({ linesPerOrder })} />
        </Field>
      </div>
      <h3 style={{ marginTop: 12 }}>Annual demand</h3>
      <SummaryTable rows={[['Stores served', totals.stores], ['Units', totals.units], ['Orders (stops)', totals.orders], ['Order lines', totals.lines], ['Cartons', totals.cartons], ['Pallets', totals.pallets]]} />
    </div>
  );
}

function SummaryTable({ rows, second }: { rows: Array<[string, number]>; second?: { label: string; values: number[]; firstLabel: string } }) {
  return (
    <div className="table-wrap" style={{ maxWidth: 520 }}>
      <table>
        {second && (
          <thead>
            <tr>
              <th />
              <th className="num">{second.firstLabel}</th>
              <th className="num">{second.label}</th>
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map(([label, value], i) => (
            <tr key={label}>
              <td>{label}</td>
              <td className="num">{fmtNum(value, value < 100 && value % 1 !== 0 ? 1 : 0)}</td>
              {second && <td className="num">{fmtNum(second.values[i], 0)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TestOrderEditor({ scenario }: { scenario: Scenario }) {
  const t = scenario.testOrder;
  const products = useApp((s) => s.ws.products);
  const hubs = useApp((s) => s.ws.hubs);
  const stores = useStores();
  const [csv, setCsv] = useState('');
  const [messages, setMessages] = useState<string[]>([]);
  const setLines = (lines: OrderLine[]) => useApp.getState().updateScenario(scenario.id, { testOrder: { ...t, lines } });
  const updateLine = (id: string, patch: Partial<OrderLine>) => setLines(t.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));

  const summary = useMemo(() => summariseTestOrder(t.lines, products, stores, hubs), [t.lines, products, stores, hubs]);
  const targetName = useMemo(() => {
    const m = new Map<string, string>();
    hubs.forEach((h) => m.set(h.id, `${h.name} hub, all stores`));
    stores.forEach((s) => m.set(s.id, s.name));
    return m;
  }, [hubs, stores]);
  const f = t.annualisationFactor;

  const importCsv = (replace: boolean) => {
    const r = parseOrderLinesCsv(csv, products, stores, hubs);
    setLines(replace ? r.items : [...t.lines, ...r.items]);
    setMessages([`${r.items.length} lines imported.`, ...r.errors]);
  };

  return (
    <>
      <div className="card">
        <h3>Test order summary</h3>
        <div className="fields" style={{ marginBottom: 8 }}>
          <Field label="Scale to a year by" hint="52 for a weekly order">
            <NumberInput
              value={f}
              min={0}
              step={1}
              onChange={(annualisationFactor) => useApp.getState().updateScenario(scenario.id, { testOrder: { ...t, annualisationFactor } })}
            />
          </Field>
        </div>
        <SummaryTable
          rows={[
            ['Units', summary.units],
            ['Cartons', summary.cartons],
            ['Pallets', summary.pallets],
            ['Orders (stores)', summary.orders],
            ['Order lines', summary.lines],
          ]}
          second={{
            firstLabel: 'Test order',
            label: `Per year (×${fmtNum(f, f % 1 ? 1 : 0)})`,
            values: [summary.units * f, summary.cartons * f, summary.pallets * f, summary.orders * f, summary.lines * f],
          }}
        />
        {summary.invalidLines > 0 && (
          <p className="error-text small" style={{ marginTop: 6 }}>
            {summary.invalidLines} lines have an unknown store, hub or product, or a quantity of 0. The engine skips them.
          </p>
        )}
        <p className="muted small" style={{ marginTop: 6 }}>
          A line for a hub spreads over all stores of that hub. Each of those stores gets one order.
        </p>
      </div>

      <div className="card">
        <div className="page-head" style={{ marginBottom: 8 }}>
          <h3>Order lines ({t.lines.length})</h3>
          <div className="row">
            <button
              onClick={() =>
                setLines([...t.lines, { id: uid('line'), targetId: hubs[0]?.id ?? '', productId: products[0]?.id ?? '', quantity: 1 }])
              }
            >
              Add line
            </button>
            <ConfirmButton className="danger" confirmLabel="Remove all lines" onConfirm={() => setLines([])} disabled={t.lines.length === 0}>
              Clear lines
            </ConfirmButton>
          </div>
        </div>
        <datalist id="targets">
          {hubs.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name} hub
            </option>
          ))}
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </datalist>
        <div className="table-wrap" style={{ maxHeight: 420 }}>
          <table>
            <thead>
              <tr>
                <th>Store or hub id</th>
                <th>Resolves to</th>
                <th>Product</th>
                <th className="num">Quantity</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {t.lines.map((l) => (
                <tr key={l.id}>
                  <td style={{ minWidth: 170 }}>
                    <input list="targets" value={l.targetId} onChange={(e) => updateLine(l.id, { targetId: e.target.value })} aria-label="Store or hub" />
                  </td>
                  <td className={targetName.has(l.targetId) ? 'small' : 'small error-text'}>{targetName.get(l.targetId) ?? 'Unknown'}</td>
                  <td>
                    <select value={l.productId} onChange={(e) => updateLine(l.id, { productId: e.target.value })} aria-label="Product">
                      {!products.some((p) => p.id === l.productId) && <option value={l.productId}>Unknown product</option>}
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.sku} · {p.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ width: 120 }}>
                    <NumberInput value={l.quantity} min={0} step={1} onChange={(quantity) => updateLine(l.id, { quantity })} label="Quantity" />
                  </td>
                  <td>
                    <button className="link" onClick={() => setLines(t.lines.filter((x) => x.id !== l.id))}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Paste from CSV</h3>
        <p className="muted small">
          Columns: target, product, quantity. Target is a store or hub id or name. Product is an id, SKU or name. Comma,
          semicolon or tab separated.
        </p>
        <textarea
          rows={6}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={'target,product,quantity\nVenlo,DUM-A01,1200\nhub-kassel-s001,DUM-T20,4'}
          aria-label="CSV order lines"
        />
        <div className="row" style={{ marginTop: 6 }}>
          <button onClick={() => importCsv(false)} disabled={!csv.trim()}>
            Append lines
          </button>
          <button onClick={() => importCsv(true)} disabled={!csv.trim()}>
            Replace lines
          </button>
        </div>
        {messages.length > 0 && (
          <ul className="small">
            {messages.map((m, i) => (
              <li key={i} className={i > 0 ? 'error-text' : undefined}>
                {m}
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
