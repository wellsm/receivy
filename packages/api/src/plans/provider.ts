import type { Environment } from '@ez4/common';
import type { Http } from '@ez4/gateway';
import type { Db } from '../database';
import type { PlanService } from './services/plan';

export declare class PlanProvider implements Http.Provider {
  services: {
    db: Environment.Service<Db>;
    plans: Environment.Service<PlanService>;
  };
}
