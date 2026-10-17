import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../../../../theme';

const TILE_SIZE = 256;
const ZOOM = 15;
const WAVE_COUNT = 3;

type RiderSearchMapProps = {
  latitude: number;
  longitude: number;
};

export default function RiderSearchMap({ latitude, longitude }: RiderSearchMapProps) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const center = worldPoint(latitude, longitude, ZOOM);

  return (
    <View
      style={styles.map}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setSize((current) => (
          current.width === width && current.height === height ? current : { width, height }
        ));
      }}
    >
      {size.width > 0 ? (
        <Tiles width={size.width} height={size.height} centerX={center.x} centerY={center.y} />
      ) : null}
      <View pointerEvents="none" style={styles.overlay}>
        {Array.from({ length: WAVE_COUNT }, (_, index) => (
          <SearchWave key={index} delay={index * 500} />
        ))}
        <View style={styles.point} />
      </View>
      <Text style={styles.attribution}>© OpenStreetMap</Text>
    </View>
  );
}

function Tiles({
  width,
  height,
  centerX,
  centerY,
}: {
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}) {
  const originX = centerX - width / 2;
  const originY = centerY - height / 2;
  const tileCount = 2 ** ZOOM;
  const startX = Math.floor(originX / TILE_SIZE);
  const endX = Math.floor((originX + width) / TILE_SIZE);
  const startY = Math.max(0, Math.floor(originY / TILE_SIZE));
  const endY = Math.min(tileCount - 1, Math.floor((originY + height) / TILE_SIZE));
  const tiles = [];
  for (let tileY = startY; tileY <= endY; tileY += 1) {
    for (let tileX = startX; tileX <= endX; tileX += 1) {
      const wrappedX = ((tileX % tileCount) + tileCount) % tileCount;
      tiles.push({ tileX, tileY, wrappedX });
    }
  }

  return (
    <>
      {tiles.map((tile) => (
        <Image
          key={`${tile.tileX}-${tile.tileY}`}
          source={{ uri: `https://tile.openstreetmap.org/${ZOOM}/${tile.wrappedX}/${tile.tileY}.png` }}
          style={{
            position: 'absolute',
            width: TILE_SIZE,
            height: TILE_SIZE,
            left: tile.tileX * TILE_SIZE - originX,
            top: tile.tileY * TILE_SIZE - originY,
          }}
        />
      ))}
    </>
  );
}

function SearchWave({ delay }: { delay: number }) {
  const scale = useRef(new Animated.Value(0.25)).current;
  const opacity = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(scale, {
            toValue: 1,
            duration: 1400,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0.08,
            duration: 1400,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(scale, {
            toValue: 0.25,
            duration: 1400,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(opacity, {
            toValue: 0.45,
            duration: 1400,
            easing: Easing.in(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [delay, opacity, scale]);

  return <Animated.View pointerEvents="none" style={[styles.wave, { opacity, transform: [{ scale }] }]} />;
}

function worldPoint(latitude: number, longitude: number, zoom: number) {
  const scale = TILE_SIZE * 2 ** zoom;
  const sine = Math.sin((latitude * Math.PI) / 180);
  return {
    x: ((longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * scale,
  };
}

const styles = StyleSheet.create({
  map: {
    height: 320,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wave: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  point: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primary,
    borderWidth: 3,
    borderColor: colors.background,
  },
  attribution: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    fontSize: typography.small,
    color: colors.text,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
  },
});
