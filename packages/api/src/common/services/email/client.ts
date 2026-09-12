export type EmailTransport = 'disabled' | 'file' | 'resend';

export interface EmailProvider {
  send(message: EmailInputs.Message): Promise<EmailOutputs.Result>;
}

export interface EmailClient {
  send(transport: EmailTransport, message: EmailInputs.Message): Promise<EmailOutputs.Result>;
}

export namespace EmailInputs {
  export type Message = {
    from: string;
    to: string;
    subject: string;
    text: string;
    /**
     * Stable idempotency key for retried deliveries (notifications).
     */
    key?: string;
  };
}

export namespace EmailOutputs {
  export type Result = Accepted | Rejected;

  export type Accepted = {
    status: 'accepted';
    id: string;
  };

  export type Rejected = {
    status: 'disabled' | 'transient' | 'permanent' | 'uncertain';
  };
}

export const EMAIL_TRANSPORTS: readonly EmailTransport[] = ['disabled', 'file', 'resend'];

export const isEmailTransport = (value: unknown): value is EmailTransport => {
  return typeof value === 'string' && EMAIL_TRANSPORTS.includes(value as EmailTransport);
};
