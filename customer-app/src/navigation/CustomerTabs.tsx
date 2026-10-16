import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons';
import { createBottomTabNavigator, type BottomTabBarButtonProps } from '@react-navigation/bottom-tabs';
import { PlatformPressable } from '@react-navigation/elements';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ProfileScreen from '../features/account/presentation/screens/ProfileScreen';
import CustomerHomeScreen from '../features/auth/presentation/screens/CustomerHomeScreen';
import RequestsScreen from '../features/requests/presentation/screens/RequestsScreen';
import { colors, radius, spacing, typography } from '../theme';
import type { CustomerTabParamList } from './types';

const Tab = createBottomTabNavigator<CustomerTabParamList>();

function TabButton({ children, style, ...props }: BottomTabBarButtonProps) {
  const selected = props['aria-selected'] === true;

  return (
    <PlatformPressable {...props} style={style}>
      <View
        collapsable={false}
        style={[styles.tabBox, selected && styles.tabBoxSelected]}
      >
        {children}
      </View>
    </PlatformPressable>
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
        tabBarButton: (props) => <TabButton {...props} />,
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
          tabBarIcon: ({ color, size }) => (
            <MaterialDesignIcons name="home-outline" color={color} size={size} />
          ),
          tabBarLabel: 'Home',
        }}
      />
      <Tab.Screen
        name="Requests"
        component={RequestsScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <MaterialDesignIcons name="package-variant" color={color} size={size} />
          ),
          tabBarLabel: 'Deliveries',
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarIcon: ({ color, size }) => (
            <MaterialDesignIcons name="account-outline" color={color} size={size} />
          ),
          tabBarLabel: 'Profile',
        }}
      />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.lg,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  tabBoxSelected: {
    backgroundColor: colors.primaryLight,
    borderRadius: radius.lg,
  },
});
