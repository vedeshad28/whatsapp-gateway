import { describe, expect, it } from 'vitest';
import {
  BOOKING_OTP_TEMPLATE,
  BOOKING_TEMPLATE_NAMES,
  buildBookingUtilityTemplates,
} from './booking-templates';
import { buildAuthenticationMetaPayload, buildMetaTemplatePayload } from './template-components';
import { buildSendComponents } from './template-send-builder';
import { extractVariableIndices, validateTemplatePayload } from './template-validators';
import type { MessageTemplate } from '@/types';

const WITH_URLS = { appBaseUrl: 'https://app.example.com' };

describe('booking utility templates', () => {
  const templates = buildBookingUtilityTemplates(WITH_URLS);

  it('defines the nine customer and salon messages exactly once each', () => {
    expect(templates.map((t) => t.name)).toEqual([
      'booking_confirmed',
      'booking_request_received',
      'booking_declined',
      'booking_cancelled',
      'booking_reminder',
      'salon_new_booking',
      'salon_booking_request',
      'salon_booking_cancelled_by_customer',
      'salon_booking_rescheduled_by_customer',
    ]);
    expect(BOOKING_TEMPLATE_NAMES).toEqual([BOOKING_OTP_TEMPLATE, ...templates.map((t) => t.name)]);
  });

  // Contract with salon-saas's BookingMessageFormatter, which pins the SAME numbers in
  // BookingMessageFormatterTest. If one side changes a template's variables, both tests must change.
  const VARIABLES_EXPECTED_BY_SALON_BACKEND: Record<string, number> = {
    booking_confirmed: 11,
    booking_request_received: 7,
    booking_declined: 8,
    booking_cancelled: 8,
    booking_reminder: 10,
    salon_new_booking: 9,
    salon_booking_request: 10,
    salon_booking_cancelled_by_customer: 7,
    salon_booking_rescheduled_by_customer: 8,
  };

  it('has exactly the number of variables the salon backend fills in for each template', () => {
    const actual = Object.fromEntries(
      templates.map((t) => [t.name, extractVariableIndices(t.body_text).length]),
    );
    expect(actual).toEqual(VARIABLES_EXPECTED_BY_SALON_BACKEND);
  });

  it.each(templates.map((t) => [t.name, t] as const))('%s passes the gateway validator', (_name, template) => {
    expect(() => validateTemplatePayload(template)).not.toThrow();
  });

  it.each(templates.map((t) => [t.name, t] as const))(
    '%s has a sample for every variable and none dangling',
    (_name, template) => {
      const vars = extractVariableIndices(template.body_text);
      expect(template.sample_values?.body).toHaveLength(vars.length);
    },
  );

  // Meta rejects a body that opens or closes with a variable, so catch it here, not in review.
  it.each(templates.map((t) => [t.name, t] as const))('%s does not start or end with a variable', (_name, template) => {
    // Meta counts a variable followed only by punctuation ("…ref {{8}}.") as being at the end too.
    const body = template.body_text.trim().replace(/[\s.!?,:;)\]]+$/, '');
    expect(body).not.toMatch(/^\{\{\d+\}\}/);
    expect(body).not.toMatch(/\{\{\d+\}\}$/);
  });

  it.each(templates.map((t) => [t.name, t] as const))('%s is a Utility template of 1024 chars or fewer', (_name, t) => {
    expect(t.category).toBe('Utility');
    expect(t.body_text.length).toBeLessThanOrEqual(1024);
  });

  it('never puts a staff-typed field in a customer message (no reason / notes variable)', () => {
    for (const t of templates) expect(t.body_text.toLowerCase()).not.toMatch(/reason|notes/);
  });

  it('adds the buttons only when the app has a public https address', () => {
    const buttonsOf = (opts: { appBaseUrl?: string | null }, name: string) =>
      buildBookingUtilityTemplates(opts).find((t) => t.name === name)?.buttons ?? [];

    expect(buttonsOf(WITH_URLS, 'booking_confirmed')).toEqual([
      expect.objectContaining({ type: 'URL', text: 'Manage booking', url: 'https://app.example.com/book/{{1}}' }),
    ]);
    expect(buttonsOf(WITH_URLS, 'salon_booking_request')).toEqual([
      expect.objectContaining({ type: 'URL', text: 'Open requests', url: 'https://app.example.com/appointments' }),
    ]);
    for (const opts of [{}, { appBaseUrl: null }, { appBaseUrl: 'http://localhost:3000' }, { appBaseUrl: 'not a url' }]) {
      expect(buttonsOf(opts, 'booking_confirmed')).toEqual([]);
      expect(buttonsOf(opts, 'salon_booking_request')).toEqual([]);
    }
  });

  it('builds a Meta payload with a dynamic-suffix URL button for the manage link', () => {
    const confirmed = templates.find((t) => t.name === 'booking_confirmed')!;
    const meta = buildMetaTemplatePayload(confirmed);

    expect(meta.category).toBe('UTILITY');
    const buttons = meta.components.find((c) => c.type === 'BUTTONS');
    expect(buttons?.buttons?.[0]).toMatchObject({ type: 'URL', url: 'https://app.example.com/book/{{1}}' });
  });
});

describe('authentication (one-time code) template', () => {
  it('builds the payload Meta expects: no body text, expiry on the footer, an OTP copy-code button', () => {
    expect(buildAuthenticationMetaPayload('booking_otp', 'en', 5, 'Copy code')).toEqual({
      name: 'booking_otp',
      category: 'AUTHENTICATION',
      language: 'en',
      components: [
        { type: 'BODY', add_security_recommendation: true },
        { type: 'FOOTER', code_expiration_minutes: 5 },
        { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copy code' }] },
      ],
    });
  });

  const authRow = (overrides: Partial<MessageTemplate> = {}): MessageTemplate => ({
    id: 'r',
    user_id: 'u',
    name: 'booking_otp',
    category: 'Authentication',
    language: 'en',
    // As Meta reports it back — a synced row may even come without the placeholder.
    body_text: '{{1}} is your verification code. For your security, do not share it.',
    buttons: [{ type: 'OTP', text: 'Copy code' }],
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  });

  it('sends the code as the body variable AND as the URL-type button parameter', () => {
    expect(buildSendComponents(authRow(), { body: ['482913'], buttonParams: { 0: '482913' } })).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: '482913' }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '482913' }] },
    ]);
  });

  it('still sends the body code when the synced row lost its placeholder', () => {
    const components = buildSendComponents(authRow({ body_text: '' }), {
      body: ['482913'],
      buttonParams: { 0: '482913' },
    });
    expect(components[0]).toEqual({ type: 'body', parameters: [{ type: 'text', text: '482913' }] });
  });

  it('refuses to send without a code rather than falling back to an example code', () => {
    expect(() => buildSendComponents(authRow(), { body: ['482913'] })).toThrow(/needs the code/);
  });
});
