import { useMemo } from 'react';
import { uid } from '../data/templates';
import { countryCoverage } from '../engine/coverage';
import type { CountryCode } from '../engine/types';
import { useApp, useAssumptionValues, useStores } from '../state/store';
import { DataFlag, DummyBadge } from '../ui/DataFlag';
import { fmtNum, fmtPct } from '../ui/format';
import { DC_COLOUR, hubColour } from '../ui/hubColours';
import { NetworkMap } from '../ui/NetworkMap';
import { NavLink } from '../ui/nav';
import { NumberInput } from '../ui/NumberInput';
import { ConfirmButton } from '../ui/ConfirmButton';

const COUNTRIES: CountryCode[] = ['NL', 'BE', 'LU', 'FR', 'DE'];
const COUNTRY_NAMES: Record<CountryCode, string> = {
  NL: 'Netherlands',
  BE: 'Belgium',
  LU: 'Luxembourg',
  FR: 'France',
  DE: 'Germany',
};

export function NetworkPage() {
  const dc = useApp((s) => s.ws.dc);
  const hubs = useApp((s) => s.ws.hubs);
  const storeSet = useApp((s) => s.ws.storeSet);
  const { updateDc, updateHub, addHub, removeHub, updateStoreSet } = useApp.getState();
  const stores = useStores();
  const a = useAssumptionValues();
  const coverage = useMemo(() => countryCoverage(hubs), [hubs]);
  const hasFranceHub = hubs.some((h) => h.country === 'FR');

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Baseline network</h1>
          <p>Central DC, hubs, delivery radius and simulated stores. Edit the tables to change the map.</p>
        </div>
      </div>

      {!hasFranceHub && (
        <div className="notice" role="note">
          <span className="badge gap">Coverage gap</span> France has no hub. Stores in France sit outside every hub radius
          except the far north near Kontich. {coverage.find((c) => c.country === 'LU')?.gap ? 'Luxembourg is also outside every radius.' : ''}
        </div>
      )}

      <div className="card">
        <NetworkMap dc={dc} hubs={hubs} stores={stores} roadFactor={a.roadFactor} label="Baseline network map" />
        <div className="legend">
          <span>
            <span className="swatch" style={{ background: DC_COLOUR }} />
            DC
          </span>
          {hubs.map((h, i) => (
            <span key={h.id}>
              <span className="swatch" style={{ background: hubColour(i) }} />
              {h.name} and its stores
            </span>
          ))}
          <span>Lines show linehaul from the DC to each hub.</span>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>
            Distribution centre <DummyBadge show={dc.isDummy} />
          </h2>
          <div className="fields">
            <label className="field">
              Name
              <input value={dc.name} onChange={(e) => updateDc({ name: e.target.value })} />
            </label>
            <label className="field">
              Latitude
              <NumberInput value={dc.lat} step={0.0001} onChange={(lat) => updateDc({ lat })} />
            </label>
            <label className="field">
              Longitude
              <NumberInput value={dc.lon} step={0.0001} onChange={(lon) => updateDc({ lon })} />
            </label>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <label className="check">
              <input
                type="checkbox"
                checked={dc.locationToConfirm}
                onChange={(e) => updateDc({ locationToConfirm: e.target.checked })}
              />
              Location to confirm
            </label>
            <DataFlag isDummy={dc.isDummy} onChange={(isDummy) => updateDc({ isDummy })} label="DC" />
          </div>
          {dc.locationToConfirm && <p className="muted small" style={{ marginTop: 8 }}>Default position near Bad Hersfeld. Location to confirm.</p>}
        </div>

        <div className="card">
          <h2>Country coverage</h2>
          <p className="muted small">Share of reference cities inside at least one hub radius.</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Country</th>
                  <th className="num">Covered</th>
                  <th>Outside every radius</th>
                </tr>
              </thead>
              <tbody>
                {coverage.map((c) => (
                  <tr key={c.country}>
                    <td className="nowrap">
                      {COUNTRY_NAMES[c.country]} {c.status === 'gap' && <span className="badge gap">Coverage gap</span>}
                      {c.status === 'partial' && <span className="badge neutral">Partial</span>}
                    </td>
                    <td className="num">{fmtPct(c.share)}</td>
                    <td className="small">{c.uncovered.join(', ') || 'None'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="page-head" style={{ marginBottom: 8 }}>
          <h2>Hubs</h2>
          <button
            onClick={() =>
              addHub({
                id: uid('hub'),
                name: 'New hub',
                country: 'FR',
                lat: 49.25,
                lon: 4.03,
                radiusKm: 100,
                storeCount: 0,
                isDummy: false,
              })
            }
          >
            Add hub
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Country</th>
                <th className="num">Latitude</th>
                <th className="num">Longitude</th>
                <th className="num">Radius km</th>
                <th className="num">Store count</th>
                <th>Data</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {hubs.map((h, i) => (
                <tr key={h.id}>
                  <td>
                    <span className="row" style={{ flexWrap: 'nowrap' }}>
                      <span className="swatch" style={{ background: hubColour(i) }} />
                      <input value={h.name} onChange={(e) => updateHub(h.id, { name: e.target.value })} aria-label="Hub name" />
                    </span>
                  </td>
                  <td>
                    <select value={h.country} onChange={(e) => updateHub(h.id, { country: e.target.value as CountryCode })} aria-label="Country">
                      {COUNTRIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <NumberInput value={h.lat} step={0.0001} onChange={(lat) => updateHub(h.id, { lat })} label="Latitude" />
                  </td>
                  <td>
                    <NumberInput value={h.lon} step={0.0001} onChange={(lon) => updateHub(h.id, { lon })} label="Longitude" />
                  </td>
                  <td>
                    <NumberInput value={h.radiusKm} min={1} onChange={(radiusKm) => updateHub(h.id, { radiusKm })} label="Radius km" />
                  </td>
                  <td>
                    <NumberInput
                      value={h.storeCount}
                      min={0}
                      step={1}
                      onChange={(storeCount) => updateHub(h.id, { storeCount: Math.round(storeCount) })}
                      label="Store count"
                    />
                  </td>
                  <td>
                    <DataFlag isDummy={h.isDummy} onChange={(isDummy) => updateHub(h.id, { isDummy })} label={h.name} />
                  </td>
                  <td>
                    <ConfirmButton className="link" confirmLabel="Delete hub" onConfirm={() => removeHub(h.id)} ariaLabel={`Delete hub ${h.name}`}>
                      Delete
                    </ConfirmButton>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>Total</td>
                <td className="num">{fmtNum(hubs.reduce((s, h) => s + h.storeCount, 0))}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>
          Store set <DummyBadge show={storeSet.isDummy} />
        </h2>
        {storeSet.mode === 'generated' ? (
          <p>
            {fmtNum(stores.length)} simulated stores, placed at random inside each hub radius with seed{' '}
            <span className="mono">{storeSet.seed}</span>. The same seed gives the same layout in every session.
          </p>
        ) : (
          <p>{fmtNum(stores.length)} imported stores. Each store links to its nearest hub as its home hub.</p>
        )}
        <div className="row">
          {storeSet.mode === 'generated' && (
            <button onClick={() => updateStoreSet({ seed: Math.floor(Math.random() * 1e9) })}>New random layout</button>
          )}
          {storeSet.mode === 'imported' && (
            <button onClick={() => updateStoreSet({ mode: 'generated' })}>Use simulated stores</button>
          )}
          <DataFlag isDummy={storeSet.isDummy} onChange={(isDummy) => updateStoreSet({ isDummy })} label="store set" />
          <NavLink to="data">Import real stores from CSV</NavLink>
        </div>
      </div>
    </>
  );
}
