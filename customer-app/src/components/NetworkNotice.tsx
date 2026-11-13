import { createContext, useCallback, useContext, useEffect, useId, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, spacing, typography } from '../theme';

export const NETWORK_UNAVAILABLE_MESSAGE = 'Network unavailable. Check your connection and try again.';

const CHARCOAL = '#2C3330';

const NetworkNoticeContext = createContext<(id: string, active: boolean) => void>(() => {});

export function NetworkNoticeProvider({ children }: { children: ReactNode }) {
  const [activeIds, setActiveIds] = useState<Record<string, true>>({});
  const report = useCallback((id: string, active: boolean) => {
    setActiveIds((current) => {
      if (active) {
        return current[id] ? current : { ...current, [id]: true };
      }
      if (!current[id]) {
        return current;
      }
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  return (
    <NetworkNoticeContext.Provider value={report}>
      <View style={styles.host}>
        {children}
        <NetworkSnackbar visible={Object.keys(activeIds).length > 0} />
      </View>
    </NetworkNoticeContext.Provider>
  );
}

export function useNetworkNotice(active: boolean) {
  const report = useContext(NetworkNoticeContext);
  const id = useId();
  useEffect(() => {
    report(id, active);
    return () => report(id, false);
  }, [active, id, report]);
}

export function isNetworkUnavailableMessage(message: string): boolean {
  return /network request failed|timed out|connection|network unavailable/i.test(message);
}

function NetworkSnackbar({ visible }: { visible: boolean }) {
  const insets = useSafeAreaInsets();
  if (!visible) {
    return null;
  }

  return (
    <View pointerEvents="none" style={[styles.overlay, { paddingBottom: insets.bottom + spacing.lg }]}>
      <View style={styles.bar} accessibilityRole="alert">
        <MaterialDesignIcons name="wifi-off" size={22} color="#FFFFFF" />
        <Text style={styles.message}>{NETWORK_UNAVAILABLE_MESSAGE}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
  },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: CHARCOAL,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    elevation: 6,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  message: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: typography.caption,
    lineHeight: 20,
  },
});
