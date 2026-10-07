import 'leaflet/dist/leaflet.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, CircleMarker, MapContainer, Polyline, TileLayer, Tooltip } from 'react-leaflet';
import type { LatLngBoundsExpression, Map as LeafletMap } from 'leaflet';
import { assignStores, DC_NODE_ID, servingNodes } from '../engine/stores';
import type { DistributionCentre, Hub, HubRole, Store } from '../engine/types';
import { CLOSED_COLOUR, DC_COLOUR, hubColour } from './hubColours';

interface Props {
  dc: DistributionCentre;
  hubs: Hub[];
  stores: Store[];
  roadFactor: number;
  openHubIds?: string[];
  hubRole?: HubRole;
  showRadius?: boolean;
  showStores?: boolean;
  size?: 'normal' | 'small';
  label?: string;
}

export function NetworkMap({
  dc,
  hubs,
  stores,
  roadFactor,
  openHubIds,
  hubRole = 'stock',
  showRadius = true,
  showStores = true,
  size = 'normal',
  label,
}: Props) {
  const open = openHubIds ?? hubs.map((h) => h.id);
  const colourByNode = useMemo(() => {
    const m = new Map<string, string>([[DC_NODE_ID, DC_COLOUR]]);
    hubs.forEach((h, i) => m.set(h.id, hubColour(i)));
    return m;
  }, [hubs]);

  const openKey = open.join('|');
  const assignments = useMemo(() => {
    const nodes = servingNodes(hubRole, openKey.split('|'), hubs, dc);
    return new Map(assignStores(stores, nodes, roadFactor || 1).map((a) => [a.storeId, a.nodeId]));
  }, [hubRole, openKey, hubs, dc, stores, roadFactor]);

  const bounds: LatLngBoundsExpression = useMemo(() => {
    const pts = [dc, ...hubs].map((p) => [p.lat, p.lon] as [number, number]);
    if (pts.length < 2) return [
      [dc.lat - 2, dc.lon - 3],
      [dc.lat + 2, dc.lon + 3],
    ];
    const lats = pts.map((p) => p[0]);
    const lons = pts.map((p) => p[1]);
    return [
      [Math.min(...lats) - 0.9, Math.min(...lons) - 1.3],
      [Math.max(...lats) + 0.9, Math.max(...lons) + 1.3],
    ];
  }, [dc, hubs]);

  const usesHubs = hubRole !== 'none' && hubs.some((h) => open.includes(h.id));

  const { wrapRef, mapRef, full, toggleFull, resetView } = useMapView(bounds);
  const isFull = full !== 'off';

  return (
    <div ref={wrapRef} className={`map-wrap ${full === 'css' ? 'css-full' : ''}`}>
      <div className="map-toolbar">
        <button onClick={resetView} title="Fit the whole network in view">
          Reset view
        </button>
        <button onClick={toggleFull} aria-pressed={isFull}>
          {isFull ? 'Exit full screen' : 'Full screen'}
        </button>
      </div>
      <div className={`map ${size === 'small' && !isFull ? 'small' : ''}`} role="region" aria-label={label ?? 'Network map'}>
      <MapContainer ref={mapRef} bounds={bounds} preferCanvas scrollWheelZoom style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {showRadius &&
          hubs.map((h, i) => (
            <Circle
              key={`r-${h.id}`}
              center={[h.lat, h.lon]}
              radius={h.radiusKm * 1000}
              pathOptions={{
                color: open.includes(h.id) && usesHubs ? hubColour(i) : CLOSED_COLOUR,
                weight: 1,
                fillOpacity: 0.05,
                dashArray: open.includes(h.id) && usesHubs ? undefined : '4 4',
              }}
            />
          ))}
        {usesHubs &&
          hubs
            .filter((h) => open.includes(h.id))
            .map((h) => (
              <Polyline
                key={`l-${h.id}`}
                positions={[
                  [dc.lat, dc.lon],
                  [h.lat, h.lon],
                ]}
                pathOptions={{ color: DC_COLOUR, weight: 2, dashArray: hubRole === 'cross-dock' ? '6 4' : undefined, opacity: 0.7 }}
              />
            ))}
        {showStores &&
          stores.map((s) => (
            <CircleMarker
              key={s.id}
              center={[s.lat, s.lon]}
              radius={2.5}
              pathOptions={{ color: colourByNode.get(assignments.get(s.id) ?? '') ?? CLOSED_COLOUR, weight: 0, fillOpacity: 0.75 }}
            >
              <Tooltip>{s.name}</Tooltip>
            </CircleMarker>
          ))}
        {hubs.map((h, i) => {
          const isOpen = usesHubs && open.includes(h.id);
          return (
            <CircleMarker
              key={`h-${h.id}`}
              center={[h.lat, h.lon]}
              radius={8}
              pathOptions={{
                color: isOpen ? '#ffffff' : CLOSED_COLOUR,
                weight: 2,
                fillColor: isOpen ? hubColour(i) : '#ffffff',
                fillOpacity: isOpen ? 1 : 0.6,
              }}
            >
              <Tooltip>
                {h.name} hub {isOpen ? '' : '(closed)'} · {h.storeCount} stores · {h.radiusKm} km radius
              </Tooltip>
            </CircleMarker>
          );
        })}
        <CircleMarker center={[dc.lat, dc.lon]} radius={10} pathOptions={{ color: '#ffffff', weight: 2, fillColor: DC_COLOUR, fillOpacity: 1 }}>
          <Tooltip permanent={size !== 'small'} direction="right">
            {dc.name}
            {dc.locationToConfirm ? ' (location to confirm)' : ''}
          </Tooltip>
        </CircleMarker>
      </MapContainer>
      </div>
      <p className="map-hint">Drag to move. Scroll or use + and − to zoom. Double-click to zoom in.{isFull ? ' Press Esc to leave full screen.' : ''}</p>
    </div>
  );
}

type FullMode = 'off' | 'native' | 'css';

/**
 * Full screen and reset view for a map. Uses the browser Fullscreen API and falls back to
 * a page-filling overlay where the browser or an embedding frame blocks it.
 */
function useMapView(bounds: LatLngBoundsExpression) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const [full, setFull] = useState<FullMode>('off');

  useEffect(() => {
    const onChange = () => {
      if (document.fullscreenElement !== wrapRef.current) setFull((f) => (f === 'native' ? 'off' : f));
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    if (full !== 'css') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFull('off');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [full]);

  // Leaflet needs a size recalculation after its container changes size.
  useEffect(() => {
    const t = window.setTimeout(() => mapRef.current?.invalidateSize(), 60);
    return () => window.clearTimeout(t);
  }, [full]);

  const toggleFull = useCallback(async () => {
    if (full === 'native') {
      await document.exitFullscreen().catch(() => undefined);
      setFull('off');
      return;
    }
    if (full === 'css') {
      setFull('off');
      return;
    }
    const el = wrapRef.current;
    try {
      if (el && typeof el.requestFullscreen === 'function' && document.fullscreenEnabled) {
        await el.requestFullscreen();
        setFull('native');
        return;
      }
    } catch {
      // blocked by the browser or an embedding frame: use the overlay instead
    }
    setFull('css');
  }, [full]);

  const resetView = useCallback(() => {
    mapRef.current?.fitBounds(bounds as Parameters<LeafletMap['fitBounds']>[0]);
  }, [bounds]);

  return { wrapRef, mapRef, full, toggleFull, resetView };
}
