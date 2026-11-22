import { contentLabel } from '../deliveries/rules';

export type ContentKind = 'parcel' | 'document' | 'food';

export function DeliveryLabels({ kind, serviceClass }: { kind: ContentKind; serviceClass?: 'EXPRESS' | 'FLEXIBLE' | null }) {
  return (
    <span className="delivery-labels">
      <span className="delivery-label"><ContentMark kind={kind} />{contentLabel(kind)}</span>
      {serviceClass ? <span className="delivery-label">{serviceClass === 'EXPRESS' ? <FlashMark /> : <MessageMark />}{serviceClass === 'EXPRESS' ? 'Urgent' : 'Flexible'}</span> : null}
    </span>
  );
}

export function ContentMark({ kind }: { kind: 'parcel' | 'document' | 'food' }) {
  if (kind === 'food') return <svg viewBox="0 0 24 24"><path d="M8 3v8a2 2 0 0 1-2 2H5v8h2v-6h1a4 4 0 0 0 4-4V3H8Zm8 0c-1.2 2.2-2 4.4-2 7a4 4 0 0 0 2 3.4V21h2v-7.2A6.8 6.8 0 0 0 20 10c0-2.6-1.2-5-4-7Z" /></svg>;
  if (kind === 'document') return <svg viewBox="0 0 24 24"><path d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6Zm0 2h7v5h5v11H6V4Zm2 8v2h8v-2H8Zm0 4v2h5v-2H8Z" /></svg>;
  return <svg viewBox="0 0 24 24"><path d="M12 2 2 7v10l10 5 10-5V7L12 2Zm0 2.2 7.2 3.8L12 11.8 4.8 8 12 4.2ZM4 9.4l7 3.6v7.1l-7-3.6V9.4Zm9 10.7v-7.1l7-3.6v7.1l-7 3.6Z" /></svg>;
}

function MessageMark() {
  return <svg viewBox="0 0 24 24"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Zm0 14H6l-2 2V4h16v12ZM6 12h12v2H6v-2Zm0-3h12v2H6V9Zm0-3h12v2H6V6Z" /></svg>;
}

function FlashMark() {
  return <svg viewBox="0 0 24 24"><path d="M11.5 20 16.4 10.3H13V4L8.5 13.7h3V20M15 2H9v2h2V2h4m2 0v2h-2V2h2M7 2v2H5V2h2M7 6V4H5v2h2M5 8V6H3v2h2M5 10V8H3v2h2M7 12v-2H5v2h2M9 14v-2H7v2h2M11 16v-2H9v2h2M13 18v-2h-2v2h2M15 20v-2h-2v2h2M17 22v-2h-2v2h2M19 10V8h-2v2h2M17 6V4h2v2h-2M17 8V6h2v2h-2Z" /></svg>;
}
