import { deepEqual, equal, ok, rejects } from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { HttpBadRequestError } from '@ez4/gateway';
import { ChargeState, PaymentLinkState, PaymentProvider, PixKeyType } from '@receivy/common';
import { settleByProvider } from '../../src/charges/services/settle';
import { EventRepository } from '../../src/common/repositories/events';
import { NoticeTemplate, sendChargeNotice } from '../../src/notifications/services/send';
import { PaymentMethodTakenError } from '../../src/payment-methods/errors';
import { publicChargeByToken, publishChargeLink } from '../../src/public/services/public-link';
import { fakeCheckout, fakeLinkCount } from '../../src/vendors/checkout/fake';
import type { CheckoutClient, CheckoutClients } from '../../src/vendors/checkout/types';
import { charges, cleanupUsers, contacts, createOnceCharge, createUser, db, grantBasicPlan, paymentMethods } from '../fixtures/financial';
import { fakeNotice } from '../fixtures/scheduling';

const OWNER = '99999999-9999-4999-8999-999999999991';
const PAYER = '99999999-9999-4999-8999-999999999992';
const SECRET = 'native-ez4-test-public-link-secret';

describe('InfinitePay charges', () => {
  let chargeId: string;

  before(async () => {
    await createUser(db, { id: OWNER, email: 'ip-owner@example.com', name: 'Dona Loja' });
    await grantBasicPlan(db, OWNER);
    await createUser(db, { id: PAYER, email: 'ip-payer@example.com', name: 'Ana Paga' });

    const person = await contacts.save(OWNER, { name: 'Ana', email: 'ip-payer@example.com' });
    const method = await paymentMethods.save(OWNER, { provider: PaymentProvider.InfinitePay, value: '$Minha.Loja' });
    const { context } = fakeNotice();

    equal(method.value, 'minha.loja');
    equal(method.kind, null);

    chargeId = (
      await createOnceCharge(db, OWNER, 'ip-1', { userId: person.userId, amountCents: 4_200, dueDate: '2026-01-01', paymentMethodId: method.id }, context)
    ).chargeId;
  });

  after(async () => cleanupUsers(db, [OWNER, PAYER]));

  it('freezes the provider on the charge and creates the checkout link after the commit', async () => {
    const detail = await charges.get(OWNER, chargeId);

    equal(detail.payment?.provider, PaymentProvider.InfinitePay);
    equal(detail.payment?.value, 'minha.loja');
    equal(detail.paymentLink?.state, PaymentLinkState.Ready);
    ok(detail.paymentLink?.url?.includes(`/dev/checkout/infinitepay/${chargeId}`));
    equal((await EventRepository.list(db, chargeId, 'charge.payment_link.created')).length, 1);
  });

  it('shows the link on the public page', async () => {
    const link = await publishChargeLink(db, OWNER, chargeId, SECRET);
    const view = await publicChargeByToken(db, link.token, SECRET);

    equal(view.payment?.provider, PaymentProvider.InfinitePay);
    equal(view.paymentLink?.state, PaymentLinkState.Ready);
  });

  it('settles through payment_check once and replays after', async () => {
    const links: CheckoutClients = {
      [PaymentProvider.InfinitePay]: fakeCheckout('https://receivy.example', PaymentProvider.InfinitePay),
      [PaymentProvider.PagSeguro]: fakeCheckout('https://receivy.example', PaymentProvider.PagSeguro)
    };
    const notices = { transport: fakeNotice().sent.transport, origin: 'https://receivy.example' };
    const input = { provider: PaymentProvider.InfinitePay as const, chargeId, transactionNsu: 'tx-1', slug: 'inv-1', receiptUrl: 'https://receipt/1' };

    equal(await settleByProvider(db, links, notices, input), 'settled');
    equal(await settleByProvider(db, links, notices, input), 'replayed');

    const detail = await charges.get(OWNER, chargeId);

    equal(detail.state, ChargeState.Paid);
    equal(detail.receiptUrl, 'https://receipt/1');
    equal((await EventRepository.list(db, chargeId, 'charge.paid'))[0]?.payload['via'], 'provider');
  });

  it('refuses editing a contact-scoped payment method into InfinitePay', async () => {
    const person = await contacts.save(OWNER, { name: 'Bia', email: 'ip-bia@example.com' });
    const contactMethod = await paymentMethods.save(OWNER, {
      provider: PaymentProvider.Pix,
      kind: PixKeyType.Email,
      value: 'bia@example.com',
      contactId: person.id
    });

    await rejects(() => paymentMethods.save(OWNER, { provider: PaymentProvider.InfinitePay, value: 'bia.tag' }, contactMethod.id), HttpBadRequestError);
  });

  it('refuses the same InfinitePay handle registered twice for one owner', async () => {
    await paymentMethods.save(OWNER, { provider: PaymentProvider.InfinitePay, value: 'proberow.tag' });

    const before = fakeLinkCount();

    await rejects(() => paymentMethods.save(OWNER, { provider: PaymentProvider.InfinitePay, value: 'proberow.tag' }), PaymentMethodTakenError);

    // The duplicate check runs ahead of the probe in the pre-flight: no link was burned on the doomed request.
    equal(fakeLinkCount(), before);
  });

  it('does not probe again editing only the label; probes once more when the handle itself changes', async () => {
    const method = await paymentMethods.save(OWNER, { provider: PaymentProvider.InfinitePay, value: 'probe-edit.tag', label: 'Loja A' });
    const afterCreate = fakeLinkCount();

    const relabeled = await paymentMethods.save(OWNER, { provider: PaymentProvider.InfinitePay, value: 'probe-edit.tag', label: 'Loja B' }, method.id);

    equal(relabeled.label, 'Loja B');
    equal(fakeLinkCount(), afterCreate);

    await paymentMethods.save(OWNER, { provider: PaymentProvider.InfinitePay, value: 'probe-edit-2.tag', label: 'Loja B' }, method.id);

    equal(fakeLinkCount(), afterCreate + 1);
  });

  it('records link_pending and sends nothing while the checkout link stays unavailable', async () => {
    const notice = fakeNotice();
    const broken: CheckoutClient = {
      createLink: async () => ({ status: 'unavailable' }),
      checkPayment: async () => ({ status: 'unavailable' }),
      inactivate: async () => ({ status: 'unavailable' }),
      verifyCredential: async () => ({ status: 'unavailable' })
    };
    const context = { ...notice.context, links: { [PaymentProvider.InfinitePay]: broken, [PaymentProvider.PagSeguro]: broken } };
    const method = await paymentMethods.save(OWNER, { provider: PaymentProvider.InfinitePay, value: 'link-pending.tag' });

    const { chargeId: pendingId } = await createOnceCharge(
      db,
      OWNER,
      'ip-link-pending',
      { userId: PAYER, amountCents: 1_000, dueDate: '2026-01-01', paymentMethodId: method.id },
      context
    );

    const result = await sendChargeNotice(db, context, pendingId, NoticeTemplate.Initial);

    deepEqual(result, { channels: [] });
    equal(notice.sent.pushes.length, 0);
    equal(notice.sent.emails.length, 0);

    const skipped = await EventRepository.list(db, pendingId, 'notice.skipped');

    equal(skipped.at(-1)?.payload['reason'], 'link_pending');
  });
});
