// ============================================================
// The WhatsApp templates the salon app's online booking sends — the one-time code, the customer's
// booking messages, and the alerts to the salon — and the idempotent "make sure this account has
// them" routine.
//
// Why this lives in the gateway: Meta approves templates per WhatsApp Business Account, so every
// account that sends booking messages needs its own copy. The salon app calls
// POST /api/v1/accounts/{id}/booking-templates when a salon connects its number (and once for the
// shared number), and this module submits whatever is missing.
//
// The variable ORDER of every template is a contract with the salon backend
// (BookingMessageFormatter in salon-saas). Change one side, change the other.
// ============================================================

import { prisma } from '@/lib/db';
import {
  isDryRun,
  submitAuthenticationTemplate,
  submitTemplate,
  syncTemplates,
  TemplateManageError,
} from '@/lib/whatsapp/template-manage';
import type { TemplatePayload } from '@/lib/whatsapp/template-validators';

export const BOOKING_TEMPLATE_LANGUAGE = 'en';
export const BOOKING_OTP_TEMPLATE = 'booking_otp';
export const OTP_EXPIRY_MINUTES = 5;

export interface BookingTemplateOptions {
  /**
   * Public https origin of the salon app (e.g. https://app.example.com). When present, the customer
   * templates get a "Manage booking" button and the salon alerts an "Open requests" button. Meta
   * rejects non-public URLs, so leave it out for local development.
   */
  appBaseUrl?: string | null;
}

function utility(
  name: string,
  body_text: string,
  samples: string[],
  buttons: TemplatePayload['buttons'] = undefined,
  footer_text?: string,
): TemplatePayload {
  const payload: TemplatePayload = {
    name,
    category: 'Utility',
    language: BOOKING_TEMPLATE_LANGUAGE,
    body_text,
    sample_values: { body: samples },
  };
  if (buttons?.length) payload.buttons = buttons;
  if (footer_text) payload.footer_text = footer_text;
  return payload;
}

function httpsOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** Utility templates, in the order they are submitted. Variable order is documented per template. */
export function buildBookingUtilityTemplates(options: BookingTemplateOptions = {}): TemplatePayload[] {
  const origin = httpsOrigin(options.appBaseUrl);
  // Dynamic suffix (tenant/branch/bookings) so one template serves every salon and branch.
  const manageButton: TemplatePayload['buttons'] = origin
    ? [{ type: 'URL', text: 'Manage booking', url: `${origin}/book/{{1}}`, example: `${origin}/book/glamour-studio/main-branch/bookings` }]
    : undefined;
  const openRequestsButton: TemplatePayload['buttons'] = origin
    ? [{ type: 'URL', text: 'Open requests', url: `${origin}/appointments` }]
    : undefined;

  return [
    // ── to the customer ──────────────────────────────────────────────────────────────────
    // 1 first name, 2 salon, 3 branch, 4 date, 5 time, 6 services, 7 stylist, 8 total,
    // 9 address, 10 branch phone, 11 booking reference
    utility(
      'booking_confirmed',
      'Hi {{1}}, your booking is confirmed ✅\n\n*{{2}}* – {{3}} branch\n📅 {{4}}, {{5}}\n✂️ {{6}} with {{7}}\n💰 ₹{{8}} · pay at the salon\n📍 {{9}}\n📞 {{10}}\n\nBooking ref: {{11}}. See you soon!',
      ['Anita', 'Glamour Studio', 'Guindy', 'Sat, 19 Oct 2030', '3:00 PM', 'Haircut, Beard trim', 'Rahul', '450', '12 Main Road, Guindy, Chennai', '+91 98765 43210', 'SAL-8F42K'],
      manageButton,
    ),
    // 1 first name, 2 salon, 3 branch, 4 date, 5 time, 6 services, 7 booking reference
    utility(
      'booking_request_received',
      "Hi {{1}}, we've received your booking request ⏳\n\n*{{2}}* – {{3}} branch\n📅 {{4}}, {{5}}\n✂️ {{6}}\n\n{{2}} will confirm shortly and we'll message you here. Booking ref: {{7}}. Thank you!",
      ['Anita', 'Glamour Studio', 'Guindy', 'Sat, 19 Oct 2030', '3:00 PM', 'Haircut, Beard trim', 'SAL-8F42K'],
      manageButton,
    ),
    // 1 first name, 2 salon, 3 branch, 4 date, 5 time, 6 services, 7 branch phone, 8 booking reference
    utility(
      'booking_declined',
      "Hi {{1}}, sorry – {{2}} couldn't confirm your booking request ❌\n\n{{3}} branch\n📅 {{4}}, {{5}}\n✂️ {{6}}\n\nNothing has been charged. Please choose another time or call us on {{7}}. Your booking reference was {{8}}. We hope to see you again soon.",
      ['Anita', 'Glamour Studio', 'Guindy', 'Sat, 19 Oct 2030', '3:00 PM', 'Haircut, Beard trim', '+91 98765 43210', 'SAL-8F42K'],
    ),
    // same variables as booking_declined
    utility(
      'booking_cancelled',
      'Hi {{1}}, your booking at {{2}} has been cancelled by the salon ❌\n\n{{3}} branch\n📅 {{4}}, {{5}}\n✂️ {{6}}\n\nWe are sorry for the inconvenience. Please call us on {{7}} to rebook. Your booking reference was {{8}}. Thank you for understanding.',
      ['Anita', 'Glamour Studio', 'Guindy', 'Sat, 19 Oct 2030', '3:00 PM', 'Haircut, Beard trim', '+91 98765 43210', 'SAL-8F42K'],
    ),
    // 1 first name, 2 salon, 3 branch, 4 date, 5 time, 6 services, 7 stylist, 8 address,
    // 9 branch phone, 10 booking reference
    utility(
      'booking_reminder',
      'Hi {{1}}, this is a friendly reminder of your upcoming booking with us ⏰\n\n*{{2}}* – {{3}} branch\n📅 Date and time: {{4}}, {{5}}\n✂️ Services: {{6}} with {{7}}\n📍 Address: {{8}}\n📞 Call us on {{9}} if you need to change anything\n\nYour booking reference is {{10}}. We look forward to seeing you soon!',
      ['Anita', 'Glamour Studio', 'Guindy', 'Sat, 19 Oct 2030', '3:00 PM', 'Haircut, Beard trim', 'Rahul', '12 Main Road, Guindy, Chennai', '+91 98765 43210', 'SAL-8F42K'],
      manageButton,
    ),

    // ── to the salon ─────────────────────────────────────────────────────────────────────
    // 1 customer name, 2 customer phone, 3 date, 4 time, 5 services, 6 stylist, 7 total,
    // 8 branch, 9 booking reference
    utility(
      'salon_new_booking',
      'New online booking received ✅\n\nCustomer: {{1}} (phone {{2}})\n📅 Date and time: {{3}}, {{4}}\n✂️ Services: {{5}} with {{6}}\n💰 Total to collect at the salon: ₹{{7}}\n\nBranch: {{8}}. Booking reference: {{9}}. This booking was made through your online booking page and is already confirmed.',
      ['Anita', '+91 98765 43210', 'Sat, 19 Oct 2030', '3:00 PM', 'Haircut, Beard trim', 'Rahul', '450', 'Guindy', 'SAL-8F42K'],
    ),
    // 1..9 as salon_new_booking, 10 time left to decide (e.g. "30 minutes")
    utility(
      'salon_booking_request',
      'New booking request ⏳ needs your approval\n\nCustomer: {{1}} ({{2}})\n📅 {{3}}, {{4}}\n✂️ {{5}} with {{6}}\n💰 ₹{{7}}\n\nBranch: {{8}}. Booking ref: {{9}}. Accept or decline it within {{10}}, or it will expire.',
      ['Anita', '+91 98765 43210', 'Sat, 19 Oct 2030', '3:00 PM', 'Haircut, Beard trim', 'Rahul', '450', 'Guindy', 'SAL-8F42K', '30 minutes'],
      openRequestsButton,
    ),
    // 1 customer name, 2 customer phone, 3 date, 4 time, 5 services, 6 branch, 7 booking reference
    utility(
      'salon_booking_cancelled_by_customer',
      'Booking cancelled by the customer ❌\n\nCustomer: {{1}} ({{2}})\n📅 {{3}}, {{4}}\n✂️ {{5}}\n\nBranch: {{6}}. Booking ref: {{7}}. The slot is open again.',
      ['Anita', '+91 98765 43210', 'Sat, 19 Oct 2030', '3:00 PM', 'Haircut, Beard trim', 'Guindy', 'SAL-8F42K'],
    ),
    // 1 customer name, 2 customer phone, 3 NEW date, 4 NEW time, 5 services, 6 stylist, 7 branch,
    // 8 booking reference
    utility(
      'salon_booking_rescheduled_by_customer',
      'Booking moved by the customer 🔁\n\nCustomer: {{1}} (phone {{2}})\n📅 New date and time: {{3}}, {{4}}\n✂️ Services: {{5}} with {{6}}\n\nBranch: {{7}}. Booking reference: {{8}}. The customer changed this booking on your online booking page, and the old slot is open again.',
      ['Anita', '+91 98765 43210', 'Sun, 20 Oct 2030', '4:00 PM', 'Haircut, Beard trim', 'Rahul', 'Guindy', 'SAL-8F42K'],
    ),
  ];
}

export const BOOKING_TEMPLATE_NAMES: string[] = [
  BOOKING_OTP_TEMPLATE,
  ...buildBookingUtilityTemplates().map((t) => t.name),
];

export interface BookingTemplateStatus {
  name: string;
  /** APPROVED / PENDING / REJECTED / DRAFT (submit failed) / MISSING (not submitted yet). */
  status: string;
  error: string | null;
}

export async function getBookingTemplateStatuses(accountId: string): Promise<BookingTemplateStatus[]> {
  const rows = await prisma.messageTemplate.findMany({
    where: { accountId, language: BOOKING_TEMPLATE_LANGUAGE, name: { in: BOOKING_TEMPLATE_NAMES } },
    select: { name: true, status: true, submissionError: true, rejectionReason: true },
  });
  const byName = new Map(rows.map((r) => [r.name, r]));
  return BOOKING_TEMPLATE_NAMES.map((name) => {
    const row = byName.get(name);
    if (!row) return { name, status: 'MISSING', error: null };
    return {
      name,
      status: (row.status ?? 'PENDING').toUpperCase(),
      error: row.submissionError ?? row.rejectionReason ?? null,
    };
  });
}

/**
 * Submits every booking template this account doesn't have yet. Safe to call repeatedly: it first
 * pulls the account's templates from Meta (so nothing is created twice), only submits missing ones
 * — plus any whose earlier submit failed — and never touches an existing or in-review template.
 * One template failing does not stop the rest; its error is returned in the status list.
 */
export async function provisionBookingTemplates(
  accountId: string,
  options: BookingTemplateOptions = {},
): Promise<BookingTemplateStatus[]> {
  // A dry run never talks to Meta, so there is nothing to pull.
  if (!isDryRun()) await syncTemplates(accountId);

  const before = new Map((await getBookingTemplateStatuses(accountId)).map((s) => [s.name, s]));
  const needsSubmit = (name: string) => {
    const s = before.get(name);
    return !s || s.status === 'MISSING' || s.status === 'DRAFT';
  };
  const failures = new Map<string, string>();

  const attempt = async (name: string, submit: () => Promise<unknown>) => {
    if (!needsSubmit(name)) return;
    try {
      await submit();
    } catch (e) {
      failures.set(name, e instanceof TemplateManageError || e instanceof Error ? e.message : 'Submit failed');
    }
  };

  await attempt(BOOKING_OTP_TEMPLATE, () =>
    submitAuthenticationTemplate(accountId, {
      name: BOOKING_OTP_TEMPLATE,
      language: BOOKING_TEMPLATE_LANGUAGE,
      expiryMinutes: OTP_EXPIRY_MINUTES,
    }),
  );
  for (const payload of buildBookingUtilityTemplates(options)) {
    await attempt(payload.name, () => submitTemplate(accountId, payload));
  }

  return (await getBookingTemplateStatuses(accountId)).map((s) => ({
    ...s,
    error: failures.get(s.name) ?? s.error,
  }));
}
