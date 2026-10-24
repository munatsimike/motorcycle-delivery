import { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../../../../theme';
import { mapTileImageSource, riderMapFrame } from '../../domain/riderMapTile';

type RiderLocationMapProps = {
  active: boolean;
  deliveryId: string;
  latitude: number;
  longitude: number;
};

export default function RiderLocationMap({ active, deliveryId, latitude, longitude }: RiderLocationMapProps) {
  const frame = riderMapFrame(active, { deliveryId, latitude, longitude });
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!frame) {
    return null;
  }
  const source = mapTileImageSource(frame.url);
  const unavailable = !source || failedUrl === frame.url;
  return (
    <View style={styles.card}>
      <Text style={styles.label}>Rider location</Text>
      {unavailable ? (
        <Text style={styles.fallback}>
          {formatPoint(latitude, longitude)}. {source ? 'Map tiles are unavailable.' : 'Map tiles are not configured.'}
        </Text>
      ) : (
        <View style={styles.map}>
          <Image
            key={`${frame.deliveryId}:${frame.url}`}
            source={source}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            accessibilityLabel="Rider location"
            onError={() => setFailedUrl(frame.url)}
          />
          <View
            pointerEvents="none"
            style={[
              styles.marker,
              { left: `${frame.markerX * 100}%`, top: `${frame.markerY * 100}%` },
            ]}
          />
        </View>
      )}
      {frame.attribution && !unavailable ? <Text style={styles.attribution}>{frame.attribution}</Text> : null}
    </View>
  );
}

function formatPoint(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    backgroundColor: colors.surface,
  },
  label: {
    fontSize: typography.caption,
    color: colors.textSecondary,
  },
  map: {
    height: 180,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  marker: {
    position: 'absolute',
    width: 14,
    height: 14,
    marginLeft: -7,
    marginTop: -7,
    borderRadius: 7,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  fallback: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  attribution: {
    fontSize: typography.caption,
    color: colors.textSecondary,
  },
});
