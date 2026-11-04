import { useParams } from 'react-router-dom';
import { Page } from '../components/Page';
import { PlaceholderNote } from '../components/PlaceholderNote';

export function DeliveryDetailsPage() {
  const { id } = useParams();

  return (
    <Page title="Delivery details">
      <PlaceholderNote>
        Placeholder. Tracking for this delivery is not connected yet.
      </PlaceholderNote>
      <p className="lede">Delivery id: {id ?? 'unknown'}</p>
    </Page>
  );
}
