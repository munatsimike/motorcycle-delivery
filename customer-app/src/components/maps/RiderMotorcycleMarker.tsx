import { Marker } from 'react-native-maps';

type Point = {
  latitude: number;
  longitude: number;
};

type RiderMotorcycleMarkerProps = {
  coordinate: Point;
  accessibilityLabel: string;
};

/**
 * Android Google Maps reliably renders bitmap-backed native markers.
 * The previous nested <Image> with tracksViewChanges turned off could
 * snapshot before the image loaded, leaving the motorcycle invisible.
 */
export default function RiderMotorcycleMarker({ coordinate, accessibilityLabel }: RiderMotorcycleMarkerProps) {
  return (
    <Marker
      coordinate={coordinate}
      image={require('./rider_motorcycle_yellow_box.png')}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={3}
      accessibilityLabel={accessibilityLabel}
    />
  );
}
