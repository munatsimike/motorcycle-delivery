import { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { imageDataUrl } from '../../domain/profilePhotoImage';
import { apiGetBytes } from '../../../../services/api/apiClient';

type RiderPortraitProps = {
  name: string;
  initials: string;
  path: string | null;
  accessToken: string | null;
  style: StyleProp<ViewStyle>;
  textStyle: StyleProp<TextStyle>;
};

export default function RiderPortrait({ name, initials, path, accessToken, style, textStyle }: RiderPortraitProps) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    if (!path || !accessToken) {
      setUri(null);
      return;
    }
    let active = true;
    apiGetBytes(path, {
      accessToken,
      headers: { Accept: 'image/jpeg,image/png,image/webp' },
    }).then((bytes) => {
      if (active) {
        setUri(bytes ? imageDataUrl(bytes) : null);
      }
    });
    return () => {
      active = false;
    };
  }, [path, accessToken]);
  const showPhoto = uri !== null && !failed;
  return (
    <View
      style={[style, styles.frame]}
      accessibilityLabel={showPhoto ? `${name} profile photo` : `${name} initials`}
    >
      {showPhoto ? (
        <Image
          source={{ uri }}
          style={styles.image}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Text style={textStyle}>{initials}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
