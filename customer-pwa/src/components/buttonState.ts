export const BUTTON_LOADING_LABEL = {
  search: 'Searching...',
  choose: 'Confirming...',
  decline: 'Declining...',
  retry: 'Retrying...',
  loadMore: 'Loading...',
  cancel: 'Cancelling...',
  delete: 'Deleting...',
  signOut: 'Signing out...',
  signIn: 'Signing in...',
  verify: 'Verifying...',
  createAccount: 'Creating account...',
  sendCode: 'Sending code...',
  save: 'Saving...',
  continue: 'Processing...',
  book: 'Booking...',
} as const;

export type ButtonLoadingAction = keyof typeof BUTTON_LOADING_LABEL;

export type ActionFeedback = {
  label: string;
  spinner: boolean;
};

export function pageActionFeedback(action: ButtonLoadingAction, active: boolean): ActionFeedback | null {
  if (!active) return null;
  return { label: BUTTON_LOADING_LABEL[action], spinner: true };
}

export function modalActionFeedback(action: ButtonLoadingAction, active: boolean): ActionFeedback | null {
  if (!active) return null;
  return { label: BUTTON_LOADING_LABEL[action], spinner: false };
}

export function beginAction(inProgress: boolean): boolean {
  return !inProgress;
}

export function searchAgainControl(input: { searching: boolean; busy: boolean; coolingDown: boolean }) {
  return {
    feedback: pageActionFeedback('search', input.searching),
    disabled: input.searching || input.busy || input.coolingDown,
  };
}
