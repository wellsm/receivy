import { type Service, ServiceEventType } from '@ez4/common';
import { type Http, HttpBadRequestError } from '@ez4/gateway';
import { expect, it, vi } from 'vitest';
import { requestListener } from './listener';

it('keeps allowlisted correlation/status but no body, path, headers or error content', () => {
  const logger = vi.spyOn(console, 'info').mockImplementation(() => {});

  try {
    requestListener(
      {
        type: ServiceEventType.Error,
        request: { traceId: 'a3a49925-d9d4-4919-a670-8c59dd0d04bd', path: '/pay/secret-token', data: 'email@example.com' },
        error: new HttpBadRequestError('secret-phone-pix-filename')
      },
      {} as Service.Context<Http.Provider>
    );
    expect(logger).toHaveBeenCalledWith({ event: 'request_failed', correlationId: 'a3a49925-d9d4-4919-a670-8c59dd0d04bd', status: 400 });
  } finally {
    logger.mockRestore();
  }
});

it('logs the whole request and the error locally so the developer sees what the app sent', () => {
  const previous = process.env.APP_DEBUG;
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  const info = vi.spyOn(console, 'info').mockImplementation(() => {});

  process.env.APP_DEBUG = 'true';

  try {
    const request = { traceId: 'a3a49925-d9d4-4919-a670-8c59dd0d04bd', method: 'POST', path: '/billings', data: '{"totalCents":1}' };

    requestListener({ type: ServiceEventType.Ready, request } as never, {} as Service.Context<Http.Provider>);
    requestListener(
      { type: ServiceEventType.Error, request, error: new HttpBadRequestError('bad') } as never,
      {} as Service.Context<Http.Provider>
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ message: '[EVENT]', context: expect.objectContaining({ path: '/billings', data: '{"totalCents":1}' }) })
    );
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ message: '[ERROR]', context: expect.objectContaining({ path: '/billings' }) })
    );
    expect(info).toHaveBeenCalledWith(expect.objectContaining({ event: 'request_failed', status: 400 }));
  } finally {
    process.env.APP_DEBUG = previous;
    log.mockRestore();
    error.mockRestore();
    info.mockRestore();
  }
});
