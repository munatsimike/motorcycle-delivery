import { useNetworkNotice } from '../../../../components/NetworkNotice';

type OfflineDeliveriesNoticeProps = {
  message: string;
  onRetry?: () => void;
};

export default function OfflineDeliveriesNotice({ message }: OfflineDeliveriesNoticeProps) {
  useNetworkNotice(message.trim().length > 0);
  return null;
}
