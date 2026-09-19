import { equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { HttpBadRequestError } from '@ez4/gateway';
import { ChargeState, PaymentLinkState, type PaymentMethod, PaymentProvider, PixKeyType } from '@receivy/common';
import { checkoutClients, inactivatePaymentLink, paymentLinkConfigFrom } from '../../src/charges/services/payment-link';
import { settleByProvider } from '../../src/charges/services/settle';
import { EventRepository } from '../../src/common/repositories/events';
import { PaymentMethodRepository } from '../../src/payment-methods/repositories/payment-method';
import { fakeCheckout } from '../../src/vendors/checkout/fake';
import type { CheckoutClients } from '../../src/vendors/checkout/types';
import { charges, cleanupUsers, contacts, createOnceCharge, createUser, db, grantBasicPlan, paymentMethods } from '../fixtures/financial';
import { fakeNotice } from '../fixtures/scheduling';

const OWNER = '99999999-9999-4999-8999-999999999993';
const PAYER = '99999999-9999-4999-8999-999999999994';
const KEY_B64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const VARIABLES = {
  PAYMENT_METHOD_LINK: 'fake',
  PUBLIC_WEB_ORIGIN: 'https://receivy.example',
  PUBLIC_LINK_HMAC_SECRET: 'native-ez4-test-public-link-secret',
  PAYMENT_CREDENTIAL_KEY_B64: KEY_B64
};

describe('PagBank charges', () => {
  let method: PaymentMethod;
  let integrationId: string;
  let chargeId: string;

  before(async () => {
    await createUser(db, { id: OWNER, email: 'pb-owner@example.com', name: 'Dona Loja' });
    await grantBasicPlan(db, OWNER);
    await createUser(db, { id: PAYER, email: 'pb-payer@example.com', name: 'Ana Paga' });

    const person = await contacts.save(OWNER, { name: 'Ana', email: 'pb-payer@example.com' });
    const { context } = fakeNotice();

    method = await paymentMethods.save(OWNER, { provider: PaymentProvider.PagSeguro, token: 'real-secret-token', label: 'Minha Loja' });

    chargeId = (
      await createOnceCharge(db, OWNER, 'pb-1', { userId: person.userId, amountCents: 4_200, dueDate: '2026-01-01', paymentMethodId: method.id }, context)
    ).chargeId;
  });

  after(async () => cleanupUsers(db, [OWNER, PAYER]));

  it('stores a sealed token, never the token, and links the method to the integration', async () => {
    integrationId = (await PaymentMethodRepository.integrationOf(db, OWNER, method.id))!;

    ok(integrationId);
    ok(!('token' in method));

    const integration = await db.integrations.findOne({ select: { credentials: true }, where: { id: integrationId } });

    ok(integration?.credentials.ciphertext.startsWith('v1.'));
    ok(!integration?.credentials.ciphertext.includes('real-secret-token'));
  });

  it('freezes the integration on the charge and creates the checkout with the stored credential', async () => {
    const row = await db.charges.findOne({
      select: { payment_snapshot: true, payment_link_state: true, provider_link_id: true },
      where: { id: chargeId }
    });

    equal(row?.payment_snapshot?.integrationId, integrationId);
    equal(row?.payment_link_state, PaymentLinkState.Ready);
    equal(row?.provider_link_id, `fake-${chargeId}`);
    equal((await EventRepository.list(db, chargeId, 'charge.payment_link.created')).length, 1);

    const detail = await charges.get(OWNER, chargeId);

    equal(detail.paymentLink?.state, PaymentLinkState.Ready);
    ok(detail.paymentLink?.url?.includes(`/dev/checkout/pagseguro/${chargeId}`));
  });

  it('settles through the fake pay route path (settleByProvider with orderId) once and replays after', async () => {
    const links: CheckoutClients = {
      [PaymentProvider.InfinitePay]: fakeCheckout('https://receivy.example', PaymentProvider.InfinitePay),
      [PaymentProvider.PagSeguro]: fakeCheckout('https://receivy.example', PaymentProvider.PagSeguro)
    };
    const notices = { transport: fakeNotice().sent.transport, origin: 'https://receivy.example' };
    const input = { provider: PaymentProvider.PagSeguro as const, chargeId, transactionNsu: 'pb-tx-1', orderId: chargeId, credential: 'fake' };

    equal(await settleByProvider(db, links, notices, input), 'settled');
    equal(await settleByProvider(db, links, notices, input), 'replayed');

    const detail = await charges.get(OWNER, chargeId);

    equal(detail.state, ChargeState.Paid);
    equal((await EventRepository.list(db, chargeId, 'charge.paid')).length, 1);
  });

  it('inactivates the checkout when the owner cancels', async () => {
    const { context } = fakeNotice();

    const { chargeId: cancelChargeId } = await createOnceCharge(
      db,
      OWNER,
      'pb-cancel',
      { userId: PAYER, amountCents: 1_500, dueDate: '2026-01-01', paymentMethodId: method.id },
      context
    );

    const cancelled = await charges.cancel(OWNER, cancelChargeId);

    equal(cancelled.state, ChargeState.Cancelled);

    await inactivatePaymentLink(db, checkoutClients(VARIABLES), paymentLinkConfigFrom(VARIABLES), cancelChargeId);

    equal((await EventRepository.list(db, cancelChargeId, 'charge.payment_link.inactivated')).length, 1);
  });

  it('keeps the credential when the method is edited without a token and revokes it on archive', async () => {
    const edited = await paymentMethods.save(OWNER, { provider: PaymentProvider.PagSeguro, label: 'Loja Renomeada' }, method.id);

    equal(edited.label, 'Loja Renomeada');
    equal(await PaymentMethodRepository.integrationOf(db, OWNER, method.id), integrationId);

    const beforeArchive = await db.integrations.findOne({ select: { revoked_at: true }, where: { id: integrationId } });

    ok(!beforeArchive?.revoked_at);

    await paymentMethods.archive(OWNER, method.id);

    const afterArchive = await db.integrations.findOne({ select: { revoked_at: true }, where: { id: integrationId } });

    ok(afterArchive?.revoked_at);
  });

  it('refuses a contact-scoped PagBank method and a create without token', async () => {
    const person = await contacts.save(OWNER, { name: 'Bia', email: 'pb-bia@example.com' });
    const contactMethod = await paymentMethods.save(OWNER, {
      provider: PaymentProvider.Pix,
      kind: PixKeyType.Email,
      value: 'bia@example.com',
      contactId: person.id
    });

    await rejects(
      () => paymentMethods.save(OWNER, { provider: PaymentProvider.PagSeguro, token: 'another-token', label: 'Loja Bia' }, contactMethod.id),
      HttpBadRequestError
    );

    await rejects(() => paymentMethods.save(OWNER, { provider: PaymentProvider.PagSeguro, label: 'Sem token' }), HttpBadRequestError);
  });
});
