/**
 * Native Customer Android draws rider_motorcycle_yellow_box.png at its
 * bitmap size, 106 by 115 device pixels, with the anchor in the center
 * and no extra scale. CSS pixels match that on-screen size when divided
 * by the screen density. The Maps JavaScript API only draws an icon when
 * its scaled size and anchor are whole pixels.
 */
export const NATIVE_MOTORCYCLE_MARKER = { width: 106, height: 115 };

export function motorcycleMarkerDisplaySize(devicePixelRatio: number): { width: number; height: number } {
  const density = devicePixelRatio > 0 ? devicePixelRatio : 1;
  return {
    width: Math.max(1, Math.round(NATIVE_MOTORCYCLE_MARKER.width / density)),
    height: Math.max(1, Math.round(NATIVE_MOTORCYCLE_MARKER.height / density)),
  };
}

type IconMaps = {
  Size: new (width: number, height: number) => unknown;
  Point: new (x: number, y: number) => unknown;
};

/**
 * The artwork is a three-quarter view. Its front wheel sits about 142 degrees
 * clockwise from the top of the image. Marker rotation is clockwise from that
 * image, so this offset is removed before a travel bearing is applied.
 */
export const MOTORCYCLE_NOSE_CLOCKWISE_DEGREES = 142;

/** Clockwise degrees to rotate the artwork so its front matches a north-up bearing. No heading leaves the artwork unrotated. */
export function markerRotation(headingDegrees: number | null, noseClockwiseDegrees = MOTORCYCLE_NOSE_CLOCKWISE_DEGREES): number {
  if (headingDegrees == null || !Number.isFinite(headingDegrees)) return 0;
  return normalizeDegrees(headingDegrees - noseClockwiseDegrees);
}

function normalizeDegrees(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

export function motorcycleMarkerIcon(maps: IconMaps, url: string, devicePixelRatio = window.devicePixelRatio, displayWidth?: number): {
  url: string;
  scaledSize: unknown;
  anchor: unknown;
} {
  const size = displayWidth == null ? motorcycleMarkerDisplaySize(devicePixelRatio) : { width: displayWidth, height: Math.round(displayWidth * 115 / 106) };
  return {
    url,
    scaledSize: new maps.Size(size.width, size.height),
    anchor: new maps.Point(size.width / 2, size.height / 2),
  };
}
