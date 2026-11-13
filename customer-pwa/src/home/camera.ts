export const HARARE = { latitude: -17.8292, longitude: 31.0522 };
export const INITIAL_SPAN = 0.07;
export const NEIGHBORHOOD_SPAN = 0.027;
export const MAP_TOP_PADDING = 48;
export const MAP_SIDE_PADDING = 24;

export type MapPoint = { latitude: number; longitude: number };

export type MapPadding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type Camera = {
  center: MapPoint;
  zoom: number;
};

export function zoomForSpan(spanDegrees: number, sizePx: number): number {
  const size = Math.max(1, sizePx);
  const span = Math.max(spanDegrees, 0.000001);
  return Math.log2((360 * size) / (256 * span));
}

/**
 * Frames `pin` in the padded viewport at `span` degrees on the shorter padded axis.
 * Bottom padding shifts the geographic center south so the pin sits above the card.
 */
export function cameraFor(input: {
  center: MapPoint;
  size: { width: number; height: number };
  span: number;
  padding: MapPadding;
  pin: MapPoint | null;
}): Camera {
  const width = input.size.width > 0 ? input.size.width : 360;
  const height = input.size.height > 0 ? input.size.height : 640;
  const paddedWidth = Math.max(1, width - input.padding.left - input.padding.right);
  const paddedHeight = Math.max(1, height - input.padding.top - input.padding.bottom);
  const heightZoom = zoomForSpan(input.span, paddedHeight);
  const widthZoom = zoomForSpan(input.span, paddedWidth);
  const zoom = Math.min(heightZoom, widthZoom);
  const limiting = heightZoom <= widthZoom ? paddedHeight : paddedWidth;
  const degreesPerPixel = input.span / limiting;
  const offsetY = (input.padding.bottom - input.padding.top) / 2;
  const origin = input.pin ?? input.center;
  return {
    center: {
      latitude: input.pin ? origin.latitude - offsetY * degreesPerPixel : origin.latitude,
      longitude: origin.longitude,
    },
    zoom,
  };
}

export function shouldAutoFrame(input: {
  gestured: boolean;
  locked: boolean;
  customer: MapPoint | null;
  cardHeight: number;
}): boolean {
  return !input.gestured && !input.locked && input.customer !== null && input.cardHeight > 0;
}
