import { Empty } from '../components/Empty';
import { Page } from '../components/Page';
import { PlaceholderNote } from '../components/PlaceholderNote';

export function DeliveriesPage() {
  return (
    <Page title="My deliveries">
      <PlaceholderNote>
        Placeholder. Delivery history will load from the customer API after sign-in is added.
      </PlaceholderNote>
      <Empty>No deliveries to show.</Empty>
    </Page>
  );
}
