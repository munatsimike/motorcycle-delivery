import * as TaskManager from 'expo-task-manager';

import { RIDER_LOCATION_TASK } from './domain/sharingPolicy';
import { riderLocationSharing } from './riderLocationSharing';

TaskManager.defineTask(RIDER_LOCATION_TASK, (body) => {
  if (body.error) {
    return riderLocationSharing.onTaskError();
  }
  return riderLocationSharing.onTaskLocations(body.data);
});
