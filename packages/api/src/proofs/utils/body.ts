import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';
import type { ProofMime } from '@receivy/common';

export declare class UploadBody implements Http.JsonBody {
  filename: String.Size<1, 200>;
  mime: ProofMime;
  size: number;
}
