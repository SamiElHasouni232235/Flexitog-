"""Test order helpers: order value, weight, volume and pallet checks."""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import pandas as pd


@dataclass
class OrderSummary:
    order_id: str
    lines: pd.DataFrame
    order_value_eur: float
    total_units: float
    total_weight_kg: float
    total_volume_m3: float
    suggested_pallets: int
    pallet_count: float | None
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def summarise(order: dict, lines: pd.DataFrame, products: pd.DataFrame, customers: pd.DataFrame,
              pallet_volume_m3: float = 1.73, pallet_max_kg: float = 500) -> OrderSummary:
    """Join order lines to the SKU master and compute order value and pallet need."""
    errors: list[str] = []
    warnings: list[str] = []
    oid = str(order.get("order_id") or "")

    if not order.get("customer_id"):
        errors.append("Customer is required.")
    elif order["customer_id"] not in set(customers["customer_id"].astype(str)):
        errors.append(f"Customer '{order['customer_id']}' is not in the customer table.")

    pallets = order.get("pallet_count")
    if pallets is None or (isinstance(pallets, float) and math.isnan(pallets)) or float(pallets) <= 0:
        errors.append("Pallet count is required and must be above 0.")
        pallets = None

    ol = lines.copy()
    if ol.empty:
        errors.append("Order has no SKU lines.")
    prod = products.set_index("sku")
    cols = ["description", "unit_price_eur", "unit_weight_kg", "length_cm", "width_cm", "height_cm",
            "units_per_pallet"]
    ol = ol.join(prod[[c for c in cols if c in prod.columns]], on="sku")

    unknown = ol.loc[ol["description"].isna(), "sku"].tolist() if not ol.empty else []
    if unknown:
        errors.append(f"Unknown SKU(s): {', '.join(map(str, unknown))}")

    ol["quantity"] = pd.to_numeric(ol["quantity"], errors="coerce").fillna(0)
    ol["line_value_eur"] = ol["quantity"] * ol["unit_price_eur"].astype(float).fillna(0)
    ol["line_weight_kg"] = ol["quantity"] * ol["unit_weight_kg"].astype(float).fillna(0)
    dims = ol[["length_cm", "width_cm", "height_cm"]].astype(float)
    ol["line_volume_m3"] = ol["quantity"] * dims.prod(axis=1, skipna=False).fillna(0) / 1e6
    upp = ol["units_per_pallet"].astype(float)
    ol["pallet_share"] = (ol["quantity"] / upp).where(upp > 0)

    missing_price = ol.loc[ol["unit_price_eur"].isna() & ol["description"].notna(), "sku"].tolist()
    if missing_price:
        warnings.append(f"No unit price for {', '.join(missing_price)}. Order value is understated.")

    weight = float(ol["line_weight_kg"].sum())
    volume = float(ol["line_volume_m3"].sum())
    by_upp = float(ol["pallet_share"].sum()) if ol["pallet_share"].notna().all() and len(ol) else 0.0
    by_volume = volume / pallet_volume_m3 if pallet_volume_m3 else 0.0
    by_weight = weight / pallet_max_kg if pallet_max_kg else 0.0
    # units_per_pallet reflects real packing, so it wins when every line has it.
    # Unit dimensions ignore carton packing and only serve as a fallback.
    basis = by_upp if by_upp else by_volume
    suggested = max(1, math.ceil(max(basis, by_weight) - 1e-9)) if len(ol) else 0

    if pallets is not None and suggested and float(pallets) < suggested:
        warnings.append(f"Pallet count {pallets:g} is below the {suggested} pallet(s) the SKU data suggests.")

    return OrderSummary(
        order_id=oid, lines=ol,
        order_value_eur=float(ol["line_value_eur"].sum()),
        total_units=float(ol["quantity"].sum()),
        total_weight_kg=weight, total_volume_m3=volume,
        suggested_pallets=suggested, pallet_count=float(pallets) if pallets is not None else None,
        errors=errors, warnings=warnings,
    )


def order_values(orders: pd.DataFrame, lines: pd.DataFrame, products: pd.DataFrame) -> pd.DataFrame:
    """Computed order value and line count per order, for the orders table."""
    if lines.empty:
        return orders.assign(order_value_eur=0.0, sku_lines=0)
    price = products.set_index("sku")["unit_price_eur"].astype(float)
    ol = lines.assign(value=pd.to_numeric(lines["quantity"], errors="coerce").fillna(0)
                      * lines["sku"].map(price).fillna(0))
    agg = ol.groupby("order_id").agg(order_value_eur=("value", "sum"), sku_lines=("sku", "count"))
    return orders.join(agg, on="order_id").fillna({"order_value_eur": 0.0, "sku_lines": 0})
