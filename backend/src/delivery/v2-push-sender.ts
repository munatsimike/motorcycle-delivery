export type V2PushAudience = 'customer' | 'rider';

export type V2PushMessage = {
  token: string;
  type: string;
  deliveryId: string;
  assignmentId: string;
  audience: V2PushAudience;
};

export type V2PushOutcome = 'accepted' | 'invalid' | 'temporary' | 'timeout';

export abstract class V2PushSender {
  configured(): boolean {
    return true;
  }

  abstract send(message: V2PushMessage, timeoutMs: number): Promise<V2PushOutcome>;
}
