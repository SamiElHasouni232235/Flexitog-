import { useMemo } from 'react';
import { uid } from '../data/templates';
import { productTotals } from '../engine/products';
import type { ProductCategory } from '../engine/types';
import { useApp } from '../state/store';
import { DataFlag } from '../ui/DataFlag';
import { fmtEur, fmtNum } from '../ui/format';
import { NumberInput } from '../ui/NumberInput';

const CATEGORIES: ProductCategory[] = ['small', 'standard', 'bulky'];

export function ProductsPage() {
  const products = useApp((s) => s.ws.products);
  const { updateProduct, addProduct, removeProduct } = useApp.getState();
  const totals = useMemo(() => productTotals(products), [products]);
  const byCategory = useMemo(
    () =>
      CATEGORIES.map((c) => ({
        category: c,
        count: products.filter((p) => p.category === c).length,
        mix: products.filter((p) => p.category === c).reduce((s, p) => s + p.salesMixPct, 0),
      })),
    [products],
  );
  const mixOff = Math.abs(totals.mixPct - 100) > 0.01;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Products</h1>
          <p>Product master and sales mix. The engine uses the mix to convert units into cartons, pallets, weight and value.</p>
        </div>
        <button
          onClick={() =>
            addProduct({
              id: uid('prod'),
              sku: `NEW-${products.length + 1}`,
              name: 'New product',
              category: 'standard',
              unitKg: 1,
              unitsPerCarton: 12,
              cartonsPerPallet: 60,
              unitValueEur: 10,
              salesMixPct: 0,
              isDummy: false,
            })
          }
        >
          Add product
        </button>
      </div>

      {mixOff && (
        <div className="notice" role="note">
          The sales mix adds up to {fmtNum(totals.mixPct, 1)}%. The engine scales the mix to 100%.
        </div>
      )}

      <div className="grid-3" style={{ marginBottom: 12 }}>
        <div className="card">
          <h3>Mix averages</h3>
          <table>
            <tbody>
              <tr>
                <td>Units per pallet</td>
                <td className="num">{fmtNum(totals.unitsPerPallet, 1)}</td>
              </tr>
              <tr>
                <td>Units per carton</td>
                <td className="num">{fmtNum(totals.unitsPerCarton, 1)}</td>
              </tr>
              <tr>
                <td>Value per unit</td>
                <td className="num">{fmtEur(totals.valuePerUnit, 2)}</td>
              </tr>
              <tr>
                <td>Weight per unit</td>
                <td className="num">{fmtNum(totals.kgPerUnit, 2)} kg</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>Categories</h3>
          <table>
            <tbody>
              {byCategory.map((c) => (
                <tr key={c.category}>
                  <td style={{ textTransform: 'capitalize' }}>{c.category}</td>
                  <td className="num">{c.count} products</td>
                  <td className="num">{fmtNum(c.mix, 1)}% of units</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>Mix total</h3>
          <p style={{ fontSize: 24, fontWeight: 600 }} className={mixOff ? 'error-text' : undefined}>
            {fmtNum(totals.mixPct, 1)}%
          </p>
          <p className="muted small">{products.length} products. Target 100%.</p>
        </div>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th>Category</th>
                <th className="num">kg per unit</th>
                <th className="num">Units per carton</th>
                <th className="num">Cartons per pallet</th>
                <th className="num">Units per pallet</th>
                <th className="num">€ per unit</th>
                <th className="num">Sales mix %</th>
                <th>Data</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr key={p.id}>
                  <td style={{ minWidth: 90 }}>
                    <input value={p.sku} onChange={(e) => updateProduct(p.id, { sku: e.target.value })} aria-label="SKU" />
                  </td>
                  <td style={{ minWidth: 150 }}>
                    <input value={p.name} onChange={(e) => updateProduct(p.id, { name: e.target.value })} aria-label="Name" />
                  </td>
                  <td>
                    <select
                      value={p.category}
                      onChange={(e) => updateProduct(p.id, { category: e.target.value as ProductCategory })}
                      aria-label="Category"
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <NumberInput value={p.unitKg} min={0} onChange={(unitKg) => updateProduct(p.id, { unitKg })} label="kg per unit" />
                  </td>
                  <td>
                    <NumberInput
                      value={p.unitsPerCarton}
                      min={1}
                      onChange={(unitsPerCarton) => updateProduct(p.id, { unitsPerCarton })}
                      label="Units per carton"
                    />
                  </td>
                  <td>
                    <NumberInput
                      value={p.cartonsPerPallet}
                      min={1}
                      onChange={(cartonsPerPallet) => updateProduct(p.id, { cartonsPerPallet })}
                      label="Cartons per pallet"
                    />
                  </td>
                  <td className="num">{fmtNum(p.unitsPerCarton * p.cartonsPerPallet)}</td>
                  <td>
                    <NumberInput
                      value={p.unitValueEur}
                      min={0}
                      onChange={(unitValueEur) => updateProduct(p.id, { unitValueEur })}
                      label="Value per unit"
                    />
                  </td>
                  <td>
                    <NumberInput
                      value={p.salesMixPct}
                      min={0}
                      onChange={(salesMixPct) => updateProduct(p.id, { salesMixPct })}
                      label="Sales mix percent"
                    />
                  </td>
                  <td>
                    <DataFlag isDummy={p.isDummy} onChange={(isDummy) => updateProduct(p.id, { isDummy })} label={p.name} />
                  </td>
                  <td>
                    <button className="link" onClick={() => removeProduct(p.id)} aria-label={`Delete ${p.name}`}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6}>Mix totals and weighted averages</td>
                <td className="num">{fmtNum(totals.unitsPerPallet, 1)}</td>
                <td className="num">{fmtEur(totals.valuePerUnit, 2)}</td>
                <td className="num">{fmtNum(totals.mixPct, 1)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </>
  );
}
