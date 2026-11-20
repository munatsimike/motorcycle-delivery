import { paymentBadge } from './rules';

export function PaymentBadge({ method }: { method: string | null | undefined }) {
  const label = paymentBadge(method);
  if (!label) return null;
  return <span className="payment-badge">{label}</span>;
}
