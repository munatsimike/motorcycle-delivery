import { secureSessionStore } from '../../services/session/secureSessionStore';
import { riderAuthRepository } from './data/RiderAuthApiRepository';
import { RiderSessionGate } from './domain/sessionGate';

export const riderSessionGate = new RiderSessionGate(riderAuthRepository, secureSessionStore);
