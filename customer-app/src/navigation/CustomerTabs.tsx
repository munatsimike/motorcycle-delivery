import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ProfileScreen from '../features/account/presentation/screens/ProfileScreen';
import CustomerHomeScreen from '../features/auth/presentation/screens/CustomerHomeScreen';
import RequestsScreen from '../features/requests/presentation/screens/RequestsScreen';
import { colors, radius, spacing, typography } from '../theme';
import type { CustomerTabParamList } from './types';

const Tab = createBottomTabNavigator<CustomerTabParamList>();

function TabIcon({
  name,
  color,
  size,
  focused,
}: {
  name: 'home-outline' | 'package-variant' | 'account-outline';
  color: string;
  size: number;
  focused: boolean;
}) {
  return (
    <View style={[styles.iconSlot, focused && styles.iconSlotSelected]}>
      <MaterialDesignIcons name={name} color={color} size={size} />
    </View>
  );
}

export default function CustomerTabs() {
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      safeAreaInsets={{ bottom: insets.bottom + spacing.md }}
      screenOptions={{
        headerShown: false,
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
            <TabIcon name="package-variant" color={color} size={size} focused={focused} />
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
    borderRadius: radius.pill,
  },
  iconSlotSelected: {
    backgroundColor: colors.primaryLight,
  },
});
