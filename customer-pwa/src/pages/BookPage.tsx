import { Empty } from '../components/Empty';
import { Page } from '../components/Page';
import { PlaceholderNote } from '../components/PlaceholderNote';

export function BookPage() {
  return (
    <Page title="Book a delivery">
      <PlaceholderNote>
        Placeholder. Pickup, drop-off, quotes, and bidding are not available in this setup.
      </PlaceholderNote>
      <Empty>No booking form yet.</Empty>
    </Page>
  );
}
