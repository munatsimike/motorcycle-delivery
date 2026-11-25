type IconMaps = {
  Size: new (width: number, height: number) => unknown;
  Point: new (x: number, y: number) => unknown;
};

/** Square directional artwork. Equal sides keep the motorcycle proportions, with the anchor on its centre. */
export function squareMotorcycleMarkerIcon(maps: IconMaps, url: string, display: number): {
  url: string;
  scaledSize: unknown;
  anchor: unknown;
} {
  const size = Math.max(1, Math.round(display));
  const center = Math.round(size / 2);
  return {
    url,
    scaledSize: new maps.Size(size, size),
    anchor: new maps.Point(center, center),
  };
}
