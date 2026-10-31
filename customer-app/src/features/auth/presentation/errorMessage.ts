import { SERVICE_UNAVAILABLE_MESSAGE } from '../../../services/api/apiClient';

const ROUTE_MISS = /^Cannot (GET|POST|PUT|PATCH|DELETE) \//;

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message && message !== SERVICE_UNAVAILABLE_MESSAGE && !ROUTE_MISS.test(message)) {
      return message;
    }
  }
  return fallback;
}
