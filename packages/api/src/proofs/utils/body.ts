import type { Http } from '@ez4/gateway';
import type { String } from '@ez4/schema';

export declare class UploadBody implements Http.JsonBody {
  filename: String.Size<1, 200>;
  mime: 'image/jpeg' | 'image/png' | 'application/pdf';
  size: number;
}
