import { useState } from 'react';
import { blankScenario } from '../data/templates';
import { parseOrderLinesCsv, parseStoresCsv, toCsv } from '../engine/csv';
import type { Store } from '../engine/types';
import { downloadText, useApp, useStores } from '../state/store';
import { DummyBadge } from '../ui/DataFlag';
import { fmtNum } from '../ui/format';

function readFile(file: File): Promise<string> {
  return file.text();
}

export function DataPage() {
  const ws = useApp((s) => s.ws);
  const { importWorkspace, resetToDummy, clearDummy, importStores, updateStoreSet, addScenario, updateScenario } = useApp.getState();
  const stores = useStores();
  const [jsonMsg, setJsonMsg] = useState<string>('');
  const [storeCsv, setStoreCsv] = useState('');
  const [storePreview, setStorePreview] = useState<{ items: Store[]; errors: string[] } | null>(null);
  const [orderCsv, setOrderCsv] = useState('');
  const [orderTarget, setOrderTarget] = useState<string>('new');
  const [orderMsg, setOrderMsg] = useState<string[]>([]);
  const testOrderScenarios = ws.scenarios.filter((s) => s.mode === 'test-order');

  const exportJson = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    downloadText(`supply-chain-benchmark-${stamp}.json`, JSON.stringify(ws, null, 2));
  };

  const onJsonFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const raw = JSON.parse(await readFile(file));
      if (!confirm('Replace the current workspace with this file?')) return;
      importWorkspace(raw);
      setJsonMsg(`Imported ${file.name}.`);
    } catch (e) {
      setJsonMsg(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const previewStores = (text: string) => {
    setStoreCsv(text);
    setStorePreview(text.trim() ? parseStoresCsv(text, ws.hubs) : null);
  };

  const importOrders = () => {
    const r = parseOrderLinesCsv(orderCsv, ws.products, stores, ws.hubs);
    if (r.items.length === 0) {
      setOrderMsg(['No valid lines found.', ...r.errors]);
      return;
    }
    if (orderTarget === 'new') {
      const s = { ...blankScenario('test-order'), name: 'Imported test order', testOrder: { lines: r.items, annualisationFactor: 52 } };
      addScenario(s);
      setOrderMsg([`Created scenario “${s.name}” with ${r.items.length} lines.`, ...r.errors]);
    } else {
      const s = ws.scenarios.find((x) => x.id === orderTarget);
      if (!s) return;
      updateScenario(s.id, { testOrder: { ...s.testOrder, lines: r.items } });
      setOrderMsg([`Replaced the lines of “${s.name}” with ${r.items.length} lines.`, ...r.errors]);
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Data</h1>
          <p>Save and load the full workspace, import real stores and test orders, and manage dummy data.</p>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>Workspace file</h2>
          <p className="muted small">
            The workspace saves in this browser automatically. Export a JSON file to share it or keep a version. Import replaces
            everything.
          </p>
          <div className="row">
            <button className="primary" onClick={exportJson}>
              Export JSON
            </button>
            <label className="btn">
              Import JSON
              <input
                type="file"
                accept="application/json,.json"
                className="visually-hidden"
                onChange={(e) => {
                  void onJsonFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          {jsonMsg && <p className={jsonMsg.startsWith('Import failed') ? 'error-text small' : 'small'} style={{ marginTop: 6 }}>{jsonMsg}</p>}
        </div>

        <div className="card">
          <h2>Dummy data</h2>
          <p className="muted small">
            Reset brings back the full dummy workspace. Clear removes every product, hub, store set, scenario and model still marked
            dummy, and sets dummy cost assumptions to 0 so you enter real values. The DC stays in place.
          </p>
          <div className="row">
            <button onClick={() => confirm('Replace the workspace with the dummy data?') && resetToDummy()}>Reset to dummy data</button>
            <button
              className="danger"
              onClick={() => confirm('Remove all records still marked as dummy data? Export first if you want a copy.') && clearDummy()}
            >
              Clear all dummy data
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>
          Stores <DummyBadge show={ws.storeSet.isDummy} />
        </h2>
        <p className="muted small">
          Now using {fmtNum(stores.length)} {ws.storeSet.mode === 'generated' ? 'simulated' : 'imported'} stores. CSV columns: name, lat,
          lon, country, weekly volume. Weekly volume sets each store's share of volume in volume scenarios. Each store links to the
          nearest hub as its home hub.
        </p>
        <div className="row" style={{ marginBottom: 6 }}>
          <label className="btn">
            Choose CSV file
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              className="visually-hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) previewStores(await readFile(f));
                e.target.value = '';
              }}
            />
          </label>
          <button
            onClick={() =>
              downloadText(
                'stores-template.csv',
                toCsv([
                  ['name', 'lat', 'lon', 'country', 'weekly volume'],
                  ...stores.map((s) => [s.name, s.lat.toFixed(5), s.lon.toFixed(5), s.country, s.weeklyVolume]),
                ]),
                'text/csv',
              )
            }
          >
            Export current stores as CSV
          </button>
          {ws.storeSet.mode === 'imported' && <button onClick={() => updateStoreSet({ mode: 'generated' })}>Switch back to simulated stores</button>}
        </div>
        <textarea rows={5} value={storeCsv} onChange={(e) => previewStores(e.target.value)} placeholder={'name,lat,lon,country,weekly volume\nShop Eindhoven 1,51.4416,5.4697,NL,180'} aria-label="Stores CSV" />
        {storePreview && (
          <div style={{ marginTop: 6 }}>
            <p className="small">
              {storePreview.items.length} valid stores. {storePreview.errors.length} rows with errors.
            </p>
            {storePreview.errors.length > 0 && (
              <ul className="small error-text">
                {storePreview.errors.slice(0, 8).map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
            <button
              className="primary"
              disabled={storePreview.items.length === 0}
              onClick={() => {
                importStores(storePreview.items);
                setStoreCsv('');
                setStorePreview(null);
              }}
            >
              Use these {storePreview.items.length} stores
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <h2>Test orders</h2>
        <p className="muted small">
          CSV columns: target, product, quantity. Target is a store or hub id or name. Product is an id, SKU or name.
        </p>
        <div className="row" style={{ marginBottom: 6 }}>
          <label className="btn">
            Choose CSV file
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              className="visually-hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setOrderCsv(await readFile(f));
                e.target.value = '';
              }}
            />
          </label>
          <label className="check small">
            Import into
            <select value={orderTarget} onChange={(e) => setOrderTarget(e.target.value)}>
              <option value="new">A new test order scenario</option>
              {testOrderScenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  Replace lines of {s.name}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() =>
              downloadText(
                'test-order-template.csv',
                toCsv([
                  ['target', 'product', 'quantity'],
                  [ws.hubs[0]?.name ?? 'Venlo', ws.products[0]?.sku ?? 'SKU', 1200],
                  [stores[0]?.id ?? 'store-id', ws.products[1]?.sku ?? 'SKU', 24],
                ]),
                'text/csv',
              )
            }
          >
            Download template
          </button>
        </div>
        <textarea rows={5} value={orderCsv} onChange={(e) => setOrderCsv(e.target.value)} placeholder={'target,product,quantity\nVenlo,DUM-A01,1200'} aria-label="Test order CSV" />
        <div className="row" style={{ marginTop: 6 }}>
          <button className="primary" disabled={!orderCsv.trim()} onClick={importOrders}>
            Import test order
          </button>
        </div>
        {orderMsg.length > 0 && (
          <ul className="small">
            {orderMsg.map((m, i) => (
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
