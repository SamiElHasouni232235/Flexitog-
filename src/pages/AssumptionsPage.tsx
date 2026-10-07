import { ASSUMPTION_GROUPS } from '../data/seed';
import { useApp } from '../state/store';
import { DataFlag } from '../ui/DataFlag';
import { fmtNum } from '../ui/format';
import { NumberInput } from '../ui/NumberInput';

export function AssumptionsPage() {
  const assumptions = useApp((s) => s.ws.assumptions);
  const models = useApp((s) => s.ws.models);
  const { updateAssumption, resetAssumptions } = useApp.getState();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Cost assumptions</h1>
          <p>One shared table for every model. A model replaces a value for itself through cost overrides in the model builder.</p>
        </div>
        <button className="danger" onClick={() => confirm('Reset every cost assumption to its dummy value?') && resetAssumptions()}>
          Reset all to dummy values
        </button>
      </div>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Assumption</th>
                <th className="num">Value</th>
                <th>Unit</th>
                <th className="num">Dummy value</th>
                <th>Data</th>
                <th />
              </tr>
            </thead>
            {ASSUMPTION_GROUPS.map((g) => (
              <tbody key={g}>
                <tr>
                  <th colSpan={6} scope="colgroup" style={{ position: 'static', color: 'var(--text)' }}>
                    {sentenceCase(g)}
                  </th>
                </tr>
                {assumptions
                  .filter((a) => a.group === g)
                  .map((a) => {
                    const overriddenBy = models.filter((m) => m.costOverrides[a.key] !== undefined).map((m) => m.name);
                    return (
                      <tr key={a.key}>
                        <td>
                          {a.label}
                          {overriddenBy.length > 0 && <span className="small muted"> · overridden in {overriddenBy.join(', ')}</span>}
                        </td>
                        <td style={{ width: 120 }}>
                          <NumberInput value={a.value} onChange={(value) => updateAssumption(a.key, { value })} label={a.label} />
                        </td>
                        <td className="muted small nowrap">{a.unit}</td>
                        <td className="num muted">{fmtNum(a.defaultValue, a.defaultValue % 1 ? 2 : 0)}</td>
                        <td>
                          <DataFlag isDummy={a.isDummy} onChange={(isDummy) => updateAssumption(a.key, { isDummy })} label={a.label} />
                        </td>
                        <td>
                          <button className="link" disabled={a.value === a.defaultValue} onClick={() => updateAssumption(a.key, { value: a.defaultValue })}>
                            Reset
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            ))}
          </table>
        </div>
      </div>
    </>
  );
}

function sentenceCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
