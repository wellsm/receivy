/**
 * The shared HTML shell for every Receivy e-mail. Tables and inline styles only: mail
 * clients drop flex, grid, stylesheets and webfonts, and Gmail strips inline SVG, so the
 * brand rides as type instead of a mark. Every message also carries a text alternative.
 */

const CANVAS = '#f2f3ff';
const SURFACE = '#ffffff';
const BAND = '#003828';
const PRIMARY = '#0b513d';
const MINT = '#4edea3';
const INK = '#131b2e';
const MUTED = '#566070';
const OUTLINE = '#bfc9c3';

const FONT = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

export type EmailLayout = {
  /** Small caps label over the wordmark, naming what the message is. */
  eyebrow: string;
  heading: string;
  /** One supporting sentence under the heading. */
  lead?: string;
  /** Table rows already rendered by the caller, stacked under the lead. */
  body?: string;
  /** The closing line outside the card, in place of any legal block. */
  footnote: string;
  /** The inbox preview line; the first line of the text alternative reads well here. */
  preheader: string;
};

export function emailDocument(layout: EmailLayout): string {
  const lead = layout.lead
    ? `<p style="margin:8px 0 0;font-family:${FONT};font-size:14px;line-height:1.55;color:${MUTED};">${escapeHtml(layout.lead)}</p>`
    : '';

  return [
    '<!doctype html>',
    '<html lang="pt-BR"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escapeHtml(layout.heading)}</title></head>`,
    `<body style="margin:0;padding:0;background:${CANVAS};">`,
    `<div style="display:none;font-size:0;line-height:0;max-height:0;overflow:hidden;">${escapeHtml(layout.preheader)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CANVAS};">`,
    '<tr><td align="center" style="padding:24px 12px;">',
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:${SURFACE};border:1px solid ${OUTLINE};border-radius:20px;overflow:hidden;">`,
    `<tr><td align="center" style="background:${BAND};padding:28px 24px;">`,
    `<div style="font-family:${FONT};font-size:22px;font-weight:800;letter-spacing:-0.02em;color:${SURFACE};">Receivy</div>`,
    `<div style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${MINT};padding-top:6px;">${escapeHtml(layout.eyebrow)}</div>`,
    '</td></tr>',
    '<tr><td style="padding:28px 24px;">',
    `<h1 style="margin:0;font-family:${FONT};font-size:19px;font-weight:700;line-height:1.35;color:${INK};">${escapeHtml(layout.heading)}</h1>`,
    lead,
    layout.body ?? '',
    '</td></tr>',
    '</table>',
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;">`,
    `<tr><td align="center" style="padding:16px 12px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED};">${escapeHtml(layout.footnote)}</td></tr>`,
    '</table>',
    '</td></tr></table>',
    '</body></html>'
  ].join('');
}

/** A tinted panel holding one emphasized value, used by the login code. */
export function panelRow(label: string, value: string, hint: string): string {
  return [
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;background:${CANVAS};border:1px solid ${OUTLINE};border-radius:16px;">`,
    '<tr><td align="center" style="padding:24px 16px;">',
    `<div style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${MUTED};">${escapeHtml(label)}</div>`,
    `<div style="font-family:${FONT};font-size:34px;font-weight:800;letter-spacing:0.2em;color:${PRIMARY};padding:12px 0 0 0.2em;">${escapeHtml(value)}</div>`,
    `<div style="font-family:${FONT};font-size:12px;font-weight:700;color:${PRIMARY};padding-top:12px;">${escapeHtml(hint)}</div>`,
    '</td></tr></table>'
  ].join('');
}

/** The charge summary: title on top, amount and due date side by side. */
export function chargeRow(title: string, amount: string, due: string): string {
  return [
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;background:${CANVAS};border:1px solid ${OUTLINE};border-radius:16px;">`,
    '<tr><td style="padding:18px;">',
    `<div style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${MUTED};">Título da conta</div>`,
    `<div style="font-family:${FONT};font-size:16px;font-weight:700;color:${INK};padding-top:4px;">${escapeHtml(title)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:14px;border-top:1px solid ${OUTLINE};">`,
    '<tr>',
    '<td style="padding-top:14px;" align="left">',
    `<div style="font-family:${FONT};font-size:11px;font-weight:600;color:${MUTED};">Valor</div>`,
    `<div style="font-family:${FONT};font-size:24px;font-weight:800;color:${PRIMARY};padding-top:2px;">${escapeHtml(amount)}</div>`,
    '</td>',
    '<td style="padding-top:14px;" align="right" valign="top">',
    `<div style="font-family:${FONT};font-size:11px;font-weight:600;color:${MUTED};">Vencimento</div>`,
    `<div style="font-family:${FONT};font-size:16px;font-weight:700;color:${INK};padding-top:2px;">${escapeHtml(due)}</div>`,
    '</td>',
    '</tr></table>',
    '</td></tr></table>'
  ].join('');
}

/** The single call to action, with the same address spelled out for clients that strip links. */
export function buttonRow(href: string, label: string): string {
  const safe = escapeHtml(href);

  return [
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;">',
    // `bgcolor` on the cell, not a background on the anchor: Outlook drops the styled block.
    `<tr><td align="center" bgcolor="${PRIMARY}" style="border-radius:16px;">`,
    `<a href="${safe}" style="display:inline-block;padding:16px 24px;font-family:${FONT};font-size:15px;font-weight:700;color:${SURFACE};text-decoration:none;">${escapeHtml(label)}</a>`,
    '</td></tr>',
    '<tr><td style="padding-top:12px;">',
    `<div style="background:${CANVAS};border-radius:12px;padding:12px 14px;">`,
    `<div style="font-family:${FONT};font-size:11px;font-weight:600;color:${MUTED};">Ou copie o link seguro:</div>`,
    `<div style="padding-top:4px;font-family:${FONT};font-size:12px;line-height:1.5;word-break:break-all;"><a href="${safe}" style="color:${PRIMARY};text-decoration:underline;">${safe}</a></div>`,
    '</div>',
    '</td></tr></table>'
  ].join('');
}

/** The closing advisory inside the card, marked by a left rule. */
export function noticeRow(text: string): string {
  return [
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:20px;border:1px solid ${OUTLINE};border-left:4px solid ${PRIMARY};border-radius:12px;">`,
    `<tr><td style="padding:14px 16px;font-family:${FONT};font-size:13px;line-height:1.55;color:${INK};">${escapeHtml(text)}</td></tr>`,
    '</table>'
  ].join('');
}
