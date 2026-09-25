import { describe, expect, it } from 'vitest';
import { NoticeTemplate } from '../../notifications/services/render';
import { amountText, buildChargeTemplate, templateNamesFrom } from './templates';

const input = { name: 'Marina Souza', creditor: 'Wellington', cents: 62000, dueDate: '2029-01-04', description: 'Aluguel de outubro', token: 'tok123' };

describe('buildChargeTemplate', () => {
  it('formats the amount in Brazilian cents', () => {
    expect(amountText(62000)).toBe('620,00');
    expect(amountText(5)).toBe('0,05');
  });

  it('builds the initial notice with five body parameters and the dynamic button', () => {
    const payload = buildChargeTemplate({ ...input, template: NoticeTemplate.Initial });

    expect(payload.name).toBe('receivy_charge_initial');
    expect(payload.language).toEqual({ code: 'pt_BR' });
    expect(payload.components[0]).toEqual({
      type: 'body',
      parameters: [
        { type: 'text', text: 'Marina' },
        { type: 'text', text: '620,00' },
        { type: 'text', text: '04/01/2029' },
        { type: 'text', text: 'Aluguel de outubro' },
        { type: 'text', text: 'Wellington' }
      ]
    });
    expect(payload.components[1]).toEqual({ type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'tok123' }] });
  });

  it('builds the reminder with four parameters and the manual one with the creditor second', () => {
    const reminder = buildChargeTemplate({ ...input, template: NoticeTemplate.Reminder });
    const manual = buildChargeTemplate({ ...input, template: NoticeTemplate.Manual });

    expect(reminder.name).toBe('receivy_charge_reminder');
    expect(reminder.components[0]).toMatchObject({ parameters: [{ text: 'Marina' }, { text: '620,00' }, { text: '04/01/2029' }, { text: 'Aluguel de outubro' }] });
    expect(manual.name).toBe('receivy_charge_manual');
    expect(manual.components[0]).toMatchObject({
      parameters: [{ text: 'Marina' }, { text: 'Wellington' }, { text: '620,00' }, { text: 'Aluguel de outubro' }, { text: '04/01/2029' }]
    });
  });

  it('takes template names from the environment so a new version needs no deploy', () => {
    const names = templateNamesFrom({ WHATSAPP_TEMPLATE_REMINDER: 'receivy_charge_reminder_v2' });

    expect(buildChargeTemplate({ ...input, template: NoticeTemplate.Reminder }, names).name).toBe('receivy_charge_reminder_v2');
    expect(buildChargeTemplate({ ...input, template: NoticeTemplate.Initial }, names).name).toBe('receivy_charge_initial');
  });
});
