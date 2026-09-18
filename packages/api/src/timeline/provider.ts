import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { LedgerService } from './services/ledger';

export declare class TimelineProvider implements Http.Provider {
  services: {
    ledger: Environment.Service<LedgerService>;
  };
}
