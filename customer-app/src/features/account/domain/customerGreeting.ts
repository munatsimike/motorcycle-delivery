export function customerGreeting(at: Date): string {
  return greetingForHour(at.getHours());
}

export function customerFirstName(account: {
  kind: 'INDIVIDUAL' | 'BUSINESS';
  name: string;
  contactName: string | null;
}): string | null {
  if (account.kind === 'BUSINESS') {
    return firstWord(account.contactName) ?? firstWord(account.name);
  }
  return firstWord(account.name);
}

function greetingForHour(hour: number): string {
  if (hour < 12) {
    return 'Good morning';
  }
  if (hour < 17) {
    return 'Good afternoon';
  }
  return 'Good evening';
}

function firstWord(value: string | null | undefined): string | null {
  const word = value?.trim().split(/\s+/)[0];
  return word ? word : null;
}
