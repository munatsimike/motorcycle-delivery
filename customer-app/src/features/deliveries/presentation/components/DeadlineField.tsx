import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../../../../theme';
import { deadlineError, deadlineTimestamp, formatDeadline } from '../../domain/bookingDraft';

const MINUTES = [0, 15, 30, 45] as const;

type DeadlineFieldProps = {
  value: string | null;
  onChange: (deliverBy: string) => void;
};

export default function DeadlineField({ value, onChange }: DeadlineFieldProps) {
  const selected = value ? new Date(value) : null;
  const valid = selected && !Number.isNaN(selected.getTime()) ? selected : null;
  const days = upcomingDays(new Date());

  function choose(day: Date, hour: number, minute: number) {
    const next = deadlineTimestamp({
      year: day.getFullYear(),
      month: day.getMonth() + 1,
      day: day.getDate(),
      hour,
      minute,
    });
    onChange(next);
  }

  function selectDay(day: Date) {
    const hour = valid ? valid.getHours() : 17;
    const minute = valid ? valid.getMinutes() : 0;
    const candidate = deadlineTimestamp({
      year: day.getFullYear(),
      month: day.getMonth() + 1,
      day: day.getDate(),
      hour,
      minute,
    });
    if (deadlineError(candidate)) {
      const later = nextQuarterHour(new Date());
      choose(later, later.getHours(), later.getMinutes());
      return;
    }
    onChange(candidate);
  }

  return (
    <View style={styles.block}>
      <Text style={styles.title}>Deliver by</Text>
      <Text style={styles.value}>{valid ? formatDeadline(valid.toISOString()) : 'Choose a date and time'}</Text>
      <View style={styles.days}>
        {days.map((day) => {
          const selectedDay = valid
            && valid.getFullYear() === day.getFullYear()
            && valid.getMonth() === day.getMonth()
            && valid.getDate() === day.getDate();
          return (
            <Pressable
              key={day.toDateString()}
              accessibilityRole="button"
              accessibilityState={{ selected: Boolean(selectedDay) }}
              onPress={() => selectDay(day)}
              style={[styles.day, selectedDay && styles.daySelected]}
            >
              <Text style={[styles.dayText, selectedDay && styles.dayTextSelected]}>{dayLabel(day)}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.timeRow}>
        <Stepper
          label="Hour"
          value={valid ? String(valid.getHours()).padStart(2, '0') : '--'}
          onDecrease={() => shiftHour(valid, -1, onChange)}
          onIncrease={() => shiftHour(valid, 1, onChange)}
        />
        <Stepper
          label="Minute"
          value={valid ? String(valid.getMinutes()).padStart(2, '0') : '--'}
          onDecrease={() => shiftMinute(valid, -1, onChange)}
          onIncrease={() => shiftMinute(valid, 1, onChange)}
        />
      </View>
    </View>
  );
}

function Stepper({
  label,
  value,
  onDecrease,
  onIncrease,
}: {
  label: string;
  value: string;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  return (
    <View style={styles.stepper}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepperControls}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Earlier ${label}`} onPress={onDecrease} style={styles.step}>
          <Text style={styles.stepText}>-</Text>
        </Pressable>
        <Text style={styles.stepValue}>{value}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Later ${label}`} onPress={onIncrease} style={styles.step}>
          <Text style={styles.stepText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

function shiftHour(selected: Date | null, direction: -1 | 1, onChange: (value: string) => void) {
  const base = selected ?? nextQuarterHour(new Date());
  const next = new Date(base);
  next.setHours(next.getHours() + direction);
  onChange(next.toISOString());
}

function shiftMinute(selected: Date | null, direction: -1 | 1, onChange: (value: string) => void) {
  const base = selected ?? nextQuarterHour(new Date());
  const current = MINUTES.indexOf(base.getMinutes() as (typeof MINUTES)[number]);
  const index = current === -1 ? 0 : (current + direction + MINUTES.length) % MINUTES.length;
  const next = new Date(base);
  next.setMinutes(MINUTES[index] ?? 0, 0, 0);
  if (current !== -1 && direction === 1 && index === 0) {
    next.setHours(next.getHours() + 1);
  }
  if (current !== -1 && direction === -1 && index === MINUTES.length - 1) {
    next.setHours(next.getHours() - 1);
  }
  onChange(next.toISOString());
}

function upcomingDays(now: Date): Date[] {
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + index);
    return day;
  });
}

function nextQuarterHour(now: Date): Date {
  const next = new Date(now);
  next.setSeconds(0, 0);
  const minute = MINUTES.find((value) => value > now.getMinutes());
  if (minute === undefined) {
    next.setHours(next.getHours() + 1, 0, 0, 0);
    return next;
  }
  next.setMinutes(minute, 0, 0);
  return next;
}

function dayLabel(day: Date): string {
  return `${day.getDate()} ${day.toLocaleString('en-US', { month: 'short' })}`;
}

const styles = StyleSheet.create({
  block: {
    gap: spacing.sm,
  },
  title: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  value: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.primaryDark ?? colors.primary,
  },
  days: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  day: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  daySelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  dayText: {
    fontSize: typography.caption,
    color: colors.text,
  },
  dayTextSelected: {
    fontWeight: '700',
    color: colors.primary,
  },
  timeRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  stepper: {
    flex: 1,
    gap: spacing.xs,
  },
  stepperLabel: {
    fontSize: typography.small,
    color: colors.textSecondary,
  },
  stepperControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
  },
  step: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepText: {
    fontSize: typography.heading,
    fontWeight: '700',
    color: colors.primary,
  },
  stepValue: {
    fontSize: typography.body,
    fontWeight: '700',
    color: colors.text,
  },
});
