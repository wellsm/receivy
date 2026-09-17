import type { Http } from '@ez4/gateway';
import type { NamingStyle } from '@ez4/schema';
import type {
  BillingEndedError,
  BillingInactiveError,
  BillingNotPausableError,
  BillingPreviewUnavailableError,
  BillingSnapshotLockedError,
  EditScopeNotRecurringError,
  GuestAlreadyResolvedError,
  IdempotencyMismatchError,
  PayableHasNoSplitError,
  PendingChargesWithoutStateError,
  ReceivableHasNoPayeeError,
  SettledLockedError
} from './billings/errors';
import type { BillingRoutes } from './billings/routes';
import type {
  ChargeClosedError,
  ChargeInReviewError,
  ChargeNotPaidError,
  SettledNoRemindersError,
  SilenceUnavailableError
} from './charges/errors';
import type { ChargeRoutes } from './charges/routes';
import type { TooManyRequestsError } from './common/errors';
import type { listener } from './common/services/sentry/listener';
import type { DuplicateContactError, EmailTakenError, LinkedContactError, NotLinkableError, OwnEmailError } from './contacts/errors';
import type { ContactRoutes } from './contacts/routes';
import type { HealthRoutes } from './health/routes';
import type {
  InviteBillingInactiveError,
  InviteOwnerError,
  PayableHasNoInviteError,
  SplitClosedError,
  SplitInProgressError
} from './invites/errors';
import type { InviteRoutes } from './invites/routes';
import type { DeviceOwnedElsewhereError, DeviceRegisteredError, ReminderQuotaError } from './notifications/errors';
import type { NotificationRoutes } from './notifications/routes';
import type { PixKeyTakenError } from './payment-methods/errors';
import type { PaymentMethodRoutes } from './payment-methods/routes';
import type {
  ProofDeclarationForbiddenError,
  ProofInvalidFileError,
  ProofMissingError,
  ProofPendingError,
  ProofReviewedError,
  ProofReviewInvalidError,
  ProofSizeMismatchError,
  ProofTooLargeError,
  UploadInProgressError,
  UploadMissingError
} from './proofs/errors';
import type { ProofRoutes } from './proofs/routes';
import type { PixRequiredError, PixSnapshotLockedError } from './public/errors';
import type { PublicRoutes } from './public/routes';
import type { TimelineOverflowError } from './timeline/errors';
import type { TimelineRoutes } from './timeline/routes';
import type { AvatarInvalidError, StaleSessionError } from './users/errors';
import type { UserRoutes } from './users/routes';

/** Receivy HTTP API. */
export declare class Api extends Http.Service {
  name: 'Receivy API';
  cache: Http.UseCache<{ authorizerTTL: 0 }>;

  defaults: Http.UseDefaults<{
    listener: typeof listener;
    preferences: {
      namingStyle: NamingStyle.CamelCase;
    };
    httpErrors: {
      403: [ProofDeclarationForbiddenError];
      409: [
        IdempotencyMismatchError,
        BillingPreviewUnavailableError,
        BillingEndedError,
        BillingNotPausableError,
        PayableHasNoSplitError,
        ReceivableHasNoPayeeError,
        BillingSnapshotLockedError,
        GuestAlreadyResolvedError,
        BillingInactiveError,
        SettledLockedError,
        ChargeClosedError,
        ChargeNotPaidError,
        ChargeInReviewError,
        SettledNoRemindersError,
        SilenceUnavailableError,
        LinkedContactError,
        DuplicateContactError,
        EmailTakenError,
        OwnEmailError,
        NotLinkableError,
        InviteOwnerError,
        SplitClosedError,
        SplitInProgressError,
        InviteBillingInactiveError,
        PayableHasNoInviteError,
        DeviceOwnedElsewhereError,
        DeviceRegisteredError,
        PixKeyTakenError,
        ProofPendingError,
        UploadInProgressError,
        UploadMissingError,
        ProofReviewedError,
        ProofMissingError,
        PixRequiredError,
        PixSnapshotLockedError,
        StaleSessionError
      ];
      422: [
        AvatarInvalidError,
        ProofInvalidFileError,
        ProofTooLargeError,
        ProofSizeMismatchError,
        ProofReviewInvalidError,
        TimelineOverflowError,
        PendingChargesWithoutStateError,
        EditScopeNotRecurringError
      ];
      429: [TooManyRequestsError, ReminderQuotaError];
    };
  }>;

  routes: [
    ...HealthRoutes,
    ...UserRoutes,
    ...ContactRoutes,
    ...PaymentMethodRoutes,
    ...BillingRoutes,
    ...ChargeRoutes,
    ...PublicRoutes,
    ...InviteRoutes,
    ...TimelineRoutes,
    ...ProofRoutes,
    ...NotificationRoutes
  ];

  // Browsers reach the API only through the Next BFF; this list matters for tooling and
  // must include the web origin of each published stage (see docs/environments.md).
  cors: Http.UseCors<{
    allowOrigins: ['http://localhost:3000', 'https://receivy.wellsm.dev'];
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
    allowHeaders: ['content-type', 'authorization', 'idempotency-key'];
    allowCredentials: true;
  }>;
}
