import { describe, expect, it } from 'vitest';
import { type RenderInputs, renderNotice } from './render';

const input: RenderInputs = {
  email: 'fixture@example.com',
  name: 'Fixture',
  description: 'Serviço prestado',
  cents: 12345,
  dueDate: '2026-09-20',
  publicId: 'public-id',
  version: 1,
  expires: 1893456000,
  origin: 'https://receivy.app',
  from: 'Receivy <test@example.com>'
};

describe('renderNotice', () => {
  it('renders manual exactly like reminder', () => {
    const secret = 'fixture-secret';
    const reminder = renderNotice(input, 'reminder', secret);
    const manual = renderNotice(input, 'manual', secret);
    expect(manual.subject).toBe(reminder.subject);
    expect(manual.text).toBe(reminder.text);
    expect(manual.url).toBe(reminder.url);
  });
});
