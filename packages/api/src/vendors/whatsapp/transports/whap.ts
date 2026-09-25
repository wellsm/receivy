import type { Environment, Service } from '@ez4/common';
import type { Factory } from '@ez4/factory';
import type { WhatsappInputs, WhatsappProvider, WhatsappTemplatePayload, WhatsappTextParameter } from '../client';
import { postMetaMessage } from './meta';

// The pinned whap build serves only v22.0/v23.0, whatever the Meta transport is configured with.
const WHAP_API_VERSION = 'v22.0';

/**
 * whap (github.com/fdarian/whap) fakes the Cloud API on localhost and posts status webhooks back.
 * This version takes a single body component with named parameters, and does not interpolate
 * dynamic button URLs: the fixtures under `whap/templates/` carry the link inside the body.
 */
export declare class WhapWhatsappService extends Factory.Service<WhatsappProvider> {
  handler: typeof createService;

  variables: {
    APP_STAGE: Environment.Variable<'APP_STAGE'>;
    WHAP_API_URL: Environment.VariableOrValue<'WHAP_API_URL', 'http://127.0.0.1:3011'>;
    WHAP_PHONE_NUMBER_ID: Environment.VariableOrValue<'WHAP_PHONE_NUMBER_ID', '000000000000000'>;
  };

  services: {
    variables: Environment.ServiceVariables;
  };
}

/** Flattens every component into one named body: `1`, `2`… for positional text, `button_<index>` for the URL suffix. */
function flatten(template: WhatsappTemplatePayload): WhatsappTemplatePayload {
  const parameters: WhatsappTextParameter[] = template.components.flatMap((component) =>
    component.parameters.map((parameter, index) => ({
      ...parameter,
      parameter_name: component.type === 'button' ? `button_${component.index}` : (parameter.parameter_name ?? String(index + 1))
    }))
  );

  return { ...template, components: [{ type: 'body', parameters }] };
}

export function createService({ variables }: Service.Context<WhapWhatsappService>, request: typeof fetch = globalThis.fetch): WhatsappProvider {
  const { APP_STAGE, WHAP_API_URL, WHAP_PHONE_NUMBER_ID } = variables;

  return {
    send: async (message: WhatsappInputs.Message) => {
      if (APP_STAGE === 'prd') {
        throw new Error(`WhatsApp transport 'whap' is forbidden when APP_STAGE=prd.`);
      }

      return postMetaMessage(
        {
          baseUrl: WHAP_API_URL ?? 'http://127.0.0.1:3011',
          phoneNumberId: WHAP_PHONE_NUMBER_ID ?? '000000000000000',
          apiVersion: WHAP_API_VERSION,
          accessToken: 'whap-local'
        },
        { ...message, template: flatten(message.template) },
        request
      );
    }
  };
}
