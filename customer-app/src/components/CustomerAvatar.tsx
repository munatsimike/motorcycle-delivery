import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import {
  customerAvatarColors,
  customerInitials,
} from '../features/account/domain/customerAvatar';
import { radius } from '../theme';

type CustomerAvatarProps = {
  kind: 'INDIVIDUAL' | 'BUSINESS';
  name: string | null;
  customerId?: string | null;
  photoUrl?: string | null;
  size?: number;
};

export default function CustomerAvatar({
  kind,
  name,
  customerId,
  photoUrl,
  size = 72,
}: CustomerAvatarProps) {
  const [photoFailed, setPhotoFailed] = useState(false);
  const initials = customerInitials({ kind, name });
  const palette = customerAvatarColors(customerId);
  const photo = photoUrl && !photoFailed ? photoUrl : null;

  useEffect(() => {
    setPhotoFailed(false);
  }, [photoUrl]);

  if (photo) {
    return (
      <Image
        accessibilityLabel={name ? `${name} profile photo` : 'Profile photo'}
        source={{ uri: photo }}
        onError={() => setPhotoFailed(true)}
        style={[styles.avatar, { width: size, height: size, borderRadius: radius.lg }]}
      />
    );
  }

  return (
    <View
      accessibilityLabel={initials}
      style={[
        styles.avatar,
        styles.initials,
        {
          width: size,
          height: size,
          borderRadius: radius.lg,
          backgroundColor: palette.backgroundColor,
        },
      ]}
    >
      <Text style={[styles.label, { color: palette.color, fontSize: Math.round(size * 0.36) }]}>
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    overflow: 'hidden',
  },
  initials: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontWeight: '700',
  },
});
