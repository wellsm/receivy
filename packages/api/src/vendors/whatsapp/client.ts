export const enum WhatsappTransport {
  Disabled = 'disabled',
  File = 'file',
  Whap = 'whap',
  Meta = 'meta',
  Evolution = 'evolution'
}

export type WhatsappTextParameter = { type: 'text'; text: string; parameter_name?: string };

export type WhatsappTemplateComponent =
  | { type: 'header' | 'body'; parameters: WhatsappTextParameter[] }
  | { type: 'button'; sub_type: 'url'; index: string; parameters: WhatsappTextParameter[] };

/** The Meta template object as the Cloud API takes it; whap reads the same shape. */
export type WhatsappTemplatePayload = {
  name: string;
  language: { code: 'pt_BR' };
  components: WhatsappTemplateComponent[];
};

export interface WhatsappProvider {
  send(message: WhatsappInputs.Message): Promise<WhatsappOutputs.Result>;
}

/** What the pipeline reaches: the transport name (a variable value, so a plain string) picks the provider. */
export interface WhatsappClient {
  send(transport: string, message: WhatsappInputs.Message): Promise<WhatsappOutputs.Result>;
}

export namespace WhatsappInputs {
  export type Message = {
    /** E.164 without the plus sign, as `toWhatsappNumber` builds it. */
    to: string;
    /** Stable per charge, template and rule; transports that take an idempotency key use it. */
    key: string;
    /** What the Meta transports send. */
    template: WhatsappTemplatePayload;
    /** What the free-text transports (evolution, file) send: the rendered notice text. */
    text: string;
    /** Only the evolution transport: the owner's own instance. */
    instance?: { name: string; token: string };
  };
}

export namespace WhatsappOutputs {
  export type Result = Accepted | Rejected;

  export type Accepted = {
    status: 'accepted';
    /** The provider message id: the Meta `wamid` or the Evolution `key.id`, the key a status webhook comes back with. */
    id: string;
  };

  export type Rejected = {
    status: 'disabled' | 'transient' | 'permanent';
  };
}

export const WHATSAPP_TRANSPORTS: readonly WhatsappTransport[] = [
  WhatsappTransport.Disabled,
  WhatsappTransport.File,
  WhatsappTransport.Whap,
  WhatsappTransport.Meta,
  WhatsappTransport.Evolution
];

export const isWhatsappTransport = (value: unknown): value is WhatsappTransport => {
  return typeof value === 'string' && WHATSAPP_TRANSPORTS.includes(value as WhatsappTransport);
};
