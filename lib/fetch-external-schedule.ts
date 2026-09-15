'use client';
/**
 * The network half of the external scheduled-settings source: fetches one
 * URL the visitor typed in, only when they press the explicit action button,
 * and never on a timer. `lib/scheduled-settings.ts`'s `parseExternalSchedule`
 * still does the real validation; this file only adds the network fetch and
 * the checks that only make sense once bytes have actually arrived.
 */
import { MAX_EXTERNAL_SCHEDULE_BYTES, parseExternalSchedule, type ExternalScheduleResult } from './scheduled-settings';

export async function fetchExternalSchedule(rawUrl: string): Promise<ExternalScheduleResult> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { return { ok: false, reason: 'invalid-json' }; }
  if (url.protocol !== 'https:') return { ok: false, reason: 'insecure' };

  let response: Response;
  try {
    response = await fetch(url.toString(), { mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'follow' });
  } catch {
    return { ok: false, reason: 'network' };
  }
  if (!response.ok) return { ok: false, reason: 'network' };

  let text: string;
  try { text = await response.text(); } catch { return { ok: false, reason: 'network' }; }
  if (new TextEncoder().encode(text).byteLength > MAX_EXTERNAL_SCHEDULE_BYTES) return { ok: false, reason: 'too-large' };
  return parseExternalSchedule(text);
}
