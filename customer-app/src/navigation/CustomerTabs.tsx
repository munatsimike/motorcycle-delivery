import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReduceMotion } from '../components/useMotion';
import ProfileScreen from '../features/account/presentation/screens/ProfileScreen';
import CustomerHomeScreen from '../features/auth/presentation/screens/CustomerHomeScreen';
import RequestsScreen from '../features/requests/presentation/screens/RequestsScreen';
import { colors, radius, spacing, typography } from '../theme';
import { motionDuration, TAB_ANIMATION, TAB_MS, tabSlideOffsets } from './screenMotion';
import type { CustomerTabParamList } from './types';

const Tab = createBottomTabNavigator<CustomerTabParamList>();

function tabSceneStyle(width: number) {
  const [behind, resting, incoming] = tabSlideOffsets(width);
  return ({ current }: { current: { progress: Animated.Value } }) => ({
    sceneStyle: {
      opacity: current.progress.interpolate({
        inputRange: [-1, 0, 1],
        outputRange: [0, 1, 0],
      }),
      transform: [
        {
          translateX: current.progress.interpolate({
            inputRange: [-1, 0, 1],
            outputRange: [behind, resting, incoming],
          }),
        },
      ],
    },
  });
}

function TabIcon({
  name,
  color,
  size,
  focused,
}: {
  name: 'home-outline' | 'package-variant-closed' | 'account-outline';
  color: string;
  size: number;
  focused: boolean;
}) {
  const reduce = useReduceMotion();
  const selected = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    const duration = motionDuration(TAB_MS, reduce);
    if (duration === 0) {
      selected.setValue(focused ? 1 : 0);
      return;
    }
    Animated.timing(selected, {
      toValue: focused ? 1 : 0,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [focused, reduce, selected]);

  return (
    <View style={styles.iconSlot}>
      <Animated.View pointerEvents="none" style={[styles.iconSlotSelected, { opacity: selected }]} />
      <MaterialDesignIcons name={name} color={color} size={size} />
    </View>
  );
}

export default function CustomerTabs() {
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  const { width } = useWindowDimensions();

  return (
    <Tab.Navigator
      safeAreaInsets={{ bottom: insets.bottom + spacing.md }}
      screenOptions={{
        headerShown: false,
        animation: TAB_ANIMATION,
        sceneStyleInterpolator: tabSceneStyle(width),
        transitionSpec: {
          animation: 'timing',
          config: {
            duration: motionDuration(TAB_MS, reduce),
            easing: Easing.bezier(0.4, 0, 0.2, 1),
          },
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
        },
        tabBarLabelStyle: {
          fontSize: typography.small,
          fontWeight: '300',
        },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={CustomerHomeScreen}
        options={{
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon name="home-outline" color={color} size={size} focused={focused} />
          ),
          tabBarLabel: 'Home',
        }}
      />
      <Tab.Screen
        name="Requests"
        component={RequestsScreen}
        options={{
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon name="package-variant-closed" color={color} size={size} focused={focused} />
          ),
          tabBarLabel: 'Deliveries',
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarIcon: ({ color, size, focused }) => (
            <TabIcon name="account-outline" color={color} size={size} focused={focused} />
          ),
          tabBarLabel: 'Profile',
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  iconSlot: {
    width: 64,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconSlotSelected: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 64,
    height: 32,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryLight,
  },
});
