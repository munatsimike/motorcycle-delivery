import MapView, { PROVIDER_GOOGLE } from 'react-native-maps';
import { StyleSheet } from 'react-native';

/** Decorative Harare map shared by the Deliveries list and delivery details.
 * Never requests user location or displays rider/customer coordinates.
 */
export default function DeliveryBackgroundMap() {
  return (
    <MapView
      pointerEvents="none"
      provider={PROVIDER_GOOGLE}
      style={StyleSheet.absoluteFill}
      initialRegion={{ latitude: -17.8292, longitude: 31.0522, latitudeDelta: 0.07, longitudeDelta: 0.07 }}
      scrollEnabled={false}
      zoomEnabled={false}
      rotateEnabled={false}
      pitchEnabled={false}
      showsUserLocation={false}
      showsMyLocationButton={false}
      showsCompass={false}
      toolbarEnabled={false}
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
