/**
 * Support Tickets: the recovery route for a forgotten toy lock, dressed as a
 * service desk.
 *
 * It plays the part -- a form, a ticket number, a severity nobody will honour, a
 * status that advances, a canned first reply -- and then resolves every ticket
 * the only way that works: it tells the person how to clear this site's data.
 *
 * Three things are not part of the joke.
 *
 * - **Nothing leaves the browser.** No request is made, no ticket exists
 *   anywhere else, and nobody reads it. `TICKET_DISCLOSURE` says so in plain
 *   words, is never styled by a funny level, and has a test that pins it.
 * - **It never deletes anything itself.** A web page cannot clear its own site
 *   data the way a person can in browser settings, and it would not be allowed
 *   to try: the resolution explains the steps and stands back.
 * - **No real desk is impersonated.** The desk is this planner's own fictional
 *   one, with no agent names, no company branding and no response time that
 *   would suggest a person is on the other end.
 */

export const TICKETS_STORAGE_KEY = 'gtha-support-tickets-v1';
export const MAX_TICKETS = 200;
export const MAX_DESCRIPTION = 1_000;

export const TICKET_CATEGORIES = ['forgot-pin', 'forgot-password', 'lost-authenticator', 'locked-out', 'other'] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

export const TICKET_SEVERITIES = ['low', 'medium', 'high', 'catastrophic'] as const;
export type TicketSeverity = (typeof TICKET_SEVERITIES)[number];

/** The statuses a ticket advances through. It never goes backwards. */
export const TICKET_STATUSES = ['received', 'triaged', 'escalated', 'resolved'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export type Ticket = {
  number: string;
  category: TicketCategory;
  severity: TicketSeverity;
  description: string;
  status: TicketStatus;
  createdAt: number;
  updatedAt: number;
};

/**
 * The line outside the comedy.
 *
 * Rendered as its own plain paragraph at every funny level and in every
 * language mode. A person must never sit waiting for a reply that was never
 * coming.
 */
export const TICKET_DISCLOSURE = Object.freeze({
  en: 'Nothing is sent anywhere. This ticket exists only in this browser, no network request is made, no data is collected, and nobody is reading it.',
  zh: '冇任何嘢會傳送出去。張單只係存喺呢個瀏覽器，唔會發出任何網絡請求，唔會收集任何資料，亦冇人會睇。',
});

/** A ticket number that looks the part. Local randomness only. */
export function ticketNumber(random: () => number = Math.random): string {
  const digits = String(Math.floor(random() * 1_000_000)).padStart(6, '0');
  return `DESK-${digits}`;
}

export function createTicket(input: { category: TicketCategory; severity: TicketSeverity; description: string }, now = Date.now(), random?: () => number): Ticket {
  return {
    number: ticketNumber(random),
    category: TICKET_CATEGORIES.includes(input.category) ? input.category : 'other',
    severity: TICKET_SEVERITIES.includes(input.severity) ? input.severity : 'medium',
    description: String(input.description ?? '').slice(0, MAX_DESCRIPTION),
    status: 'received',
    createdAt: now,
    updatedAt: now,
  };
}

export function advanceTicket(ticket: Ticket, now = Date.now()): Ticket {
  const index = TICKET_STATUSES.indexOf(ticket.status);
  if (index < 0 || index >= TICKET_STATUSES.length - 1) return ticket;
  return { ...ticket, status: TICKET_STATUSES[index + 1], updatedAt: now };
}

export function addTicket(tickets: readonly Ticket[], ticket: Ticket): Ticket[] {
  return [ticket, ...tickets.filter((existing) => existing.number !== ticket.number)].slice(0, MAX_TICKETS);
}

export function removeTickets(tickets: readonly Ticket[], numbers: readonly string[]): Ticket[] {
  const drop = new Set(numbers);
  return tickets.filter((ticket) => !drop.has(ticket.number));
}

export function parseTickets(raw: string | null | undefined): Ticket[] {
  let parsed: unknown;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { return []; }
  const list = (parsed as { version?: number; tickets?: unknown })?.version === 1 ? (parsed as { tickets: unknown }).tickets : null;
  if (!Array.isArray(list)) return [];
  return list.slice(0, MAX_TICKETS).flatMap((item) => {
    const ticket = item as Ticket;
    if (!ticket || typeof ticket.number !== 'string' || !/^DESK-\d{6}$/.test(ticket.number)) return [];
    if (!TICKET_CATEGORIES.includes(ticket.category) || !TICKET_SEVERITIES.includes(ticket.severity) || !TICKET_STATUSES.includes(ticket.status)) return [];
    return [{
      number: ticket.number,
      category: ticket.category,
      severity: ticket.severity,
      status: ticket.status,
      description: typeof ticket.description === 'string' ? ticket.description.slice(0, MAX_DESCRIPTION) : '',
      createdAt: Number.isFinite(ticket.createdAt) ? ticket.createdAt : 0,
      updatedAt: Number.isFinite(ticket.updatedAt) ? ticket.updatedAt : 0,
    }];
  });
}

export const serializeTickets = (tickets: readonly Ticket[]): string => JSON.stringify({ version: 1, tickets });

type Translate = (en: string, zh: string) => string;

/**
 * The canned first reply.
 *
 * Styled by the funny level through `t`, like the rest of the planner's copy.
 * The steps it ends with are plain facts and are the same at every level.
 */
export function cannedReply(ticket: Ticket, t: Translate): string {
  const opening = {
    'forgot-pin': t('Thank you for contacting the desk about a forgotten PIN. We have read the manual once and it is very clear on this.', '多謝你就唔記得 PIN 碼搵服務台。我哋睇過本手冊一次，佢講得好清楚。'),
    'forgot-password': t('Thank you for reporting a forgotten password. The desk has consulted the password and it is also not telling.', '多謝你報告唔記得密碼。服務台問過個密碼，佢都唔肯講。'),
    'lost-authenticator': t('Thank you for reporting a missing authenticator. The desk has checked under the sofa. It is not there either.', '多謝你報告唔見咗驗證器。服務台睇過梳化底，都唔喺度。'),
    'locked-out': t('Thank you for your patience while locked out. Your patience has been logged, locally, where nobody will see it.', '多謝你俾人鎖咗喺出面仲咁有耐性。你嘅耐性已經記錄低，存喺本機，冇人會睇到。'),
    other: t('Thank you for your ticket. It has been placed in a queue of one.', '多謝你開單。張單已經排咗喺一條得一張單嘅隊度。'),
  }[ticket.category];
  return opening;
}

/**
 * The resolution, which is the only part that works.
 *
 * A web page cannot open the browser's own settings or clear its own site data,
 * so this names the steps and the exact site to clear, and never pretends to do
 * it. `origin` is shown and copyable so a person can find the right entry.
 */
export function resolutionSteps(origin: string, t: Translate): string[] {
  return [
    t(`Open your browser's settings and find site data (often under Privacy, then Site settings or Cookies and site data).`, '打開瀏覽器設定，搵網站資料（通常喺「私隱」入面嘅「網站設定」或者「Cookie 同網站資料」）。'),
    t(`Find this site: ${origin}`, `搵呢個網站：${origin}`),
    t('Clear its data. Every lock is removed, and so are your saved trips, settings and these tickets.', '清除佢嘅資料。所有鎖會冇晒，已儲存嘅行程、設定同呢啲服務單都會一齊冇晒。'),
    t('Reload the planner.', '重新載入規劃工具。'),
  ];
}

/** A row per ticket, for the ordinary export. Tickets carry no credential, so nothing is omitted. */
export const ticketRows = (tickets: readonly Ticket[]): Record<string, unknown>[] =>
  tickets.map((ticket) => ({
    number: ticket.number,
    category: ticket.category,
    severity: ticket.severity,
    status: ticket.status,
    description: ticket.description,
    createdAt: new Date(ticket.createdAt).toISOString(),
    updatedAt: new Date(ticket.updatedAt).toISOString(),
  }));
