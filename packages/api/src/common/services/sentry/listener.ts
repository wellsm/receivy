import { ServiceEventType } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Queue } from '@ez4/queue';
import { isAnyString } from '@ez4/utils';
import { Logger } from '../logger';

const MAX_INPUT_LENGTH = 51200;

export async function listener(event: Http.ServiceEvent | Queue.ServiceEvent) {
  const { request } = event;

  switch (event.type) {
    case ServiceEventType.Begin: {
      break;
    }

    case ServiceEventType.Ready: {
      // Usually data contains the string version of the payload and can be omitted.
      // Only log small payloads, bigger ones should have specialized logging inside the handler.
      if ('data' in request && isAnyString(request.data) && request.data.length > MAX_INPUT_LENGTH) {
        Logger.warning('[EVENT OMITTED]', { traceId: request.traceId, maxLength: MAX_INPUT_LENGTH, length: request.data.length });
      } else {
        Logger.log('[EVENT]', { ...request, data: undefined });
      }

      break;
    }

    case ServiceEventType.Error: {
      break;
    }

    case ServiceEventType.End: {
      break;
    }
  }
}