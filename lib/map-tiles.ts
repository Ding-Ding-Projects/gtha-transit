import type { Map, TileLayer } from 'leaflet';

export function tileTemplate(info: unknown): string {
  const revision = (info as { revision?: unknown } | null)?.revision;
  if (typeof revision !== 'string' || !/^[a-f0-9]{64}$/.test(revision)) {
    throw new Error('Map revision unavailable.');
  }
  return `/tiles/${revision}/{z}/{x}/{y}.png`;
}

/** Both map surfaces follow the same independently refreshed dataset revision. */
export function attachMapTiles(
  leaflet: typeof import('leaflet'),
  map: Map,
  onError: (failed: boolean) => void,
) {
  let disposed = false;
  let active = false;
  let current = '';
  let metadataFailed = false;
  const activeTiles = new Set<HTMLElement>();
  const failedTiles = new Set<HTMLElement>();
  const report = () => {
    if (!disposed) onError(metadataFailed || failedTiles.size > 0);
  };
  const forgetTile = (event: { tile: HTMLElement }) => {
    activeTiles.delete(event.tile);
    failedTiles.delete(event.tile);
    report();
  };
  let layer: TileLayer | undefined;
  let request: AbortController | undefined;
  const refresh = async () => {
    if (disposed || active) return;
    active = true;
    request = new AbortController();
    const timeout = setTimeout(() => request?.abort(), 5000);
    try {
      const response = await fetch('/api/map-info', {
        cache: 'no-store',
        signal: request.signal,
      });
      if (!response.ok) throw new Error('Map revision unavailable.');
      const template = tileTemplate(await response.json());
      if (disposed) return;
      metadataFailed = false;
      if (!layer) {
        layer = leaflet
          .tileLayer(template, {
            minZoom: 8,
            maxNativeZoom: 13,
            maxZoom: 18,
            attribution: '© OpenStreetMap contributors',
          })
          .on('tileloadstart', (event) => {
            if (!disposed) activeTiles.add(event.tile);
          })
          .on('tileerror', (event) => {
            if (disposed || !activeTiles.has(event.tile)) return;
            failedTiles.add(event.tile);
            report();
          })
          .on('tileload', (event) => {
            failedTiles.delete(event.tile);
            report();
          })
          .on('tileunload', forgetTile)
          .on('tileabort', forgetTile)
          .addTo(map);
      } else if (template !== current) {
        layer.setUrl(template);
      } else if (failedTiles.size) {
        layer.redraw();
      }
      current = template;
      report();
    } catch {
      metadataFailed = true;
      report();
    } finally {
      clearTimeout(timeout);
      active = false;
    }
  };
  void refresh();
  const interval = setInterval(() => void refresh(), 60000);
  return () => {
    disposed = true;
    clearInterval(interval);
    request?.abort();
    layer?.remove();
    activeTiles.clear();
    failedTiles.clear();
  };
}
