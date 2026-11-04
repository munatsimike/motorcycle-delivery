import { Empty } from '../components/Empty';
import { Page } from '../components/Page';
import { PlaceholderNote } from '../components/PlaceholderNote';

export function ProfilePage() {
  return (
    <Page title="Profile">
      <PlaceholderNote>
        Placeholder. Profile details and sign-out will use the same customer accounts as the mobile app.
      </PlaceholderNote>
      <Empty>No account is loaded.</Empty>
    </Page>
  );
}
