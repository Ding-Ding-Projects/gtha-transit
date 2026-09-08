/**
 * Send failures that happen in the browser to the service that served the page.
 *
 * A thrown error in the renderer never reaches the container's log, so a
 * deployment can be visibly broken to every visitor while every server-side
 * signal reports it healthy. This closes that gap, and only that gap.
 *
 * **What is sent.** The route pattern, a bounded message, and nothing else. Not
 * the query string, which on a journey planner is where somebody lives and where
 * they are going. Not a stack, which carries file paths and sometimes values. Not
 * an identifier of any kind, because there is nothing here worth being able to
 * follow one person across.
 *
 * Bounded on this side as well as the server's: a page caught in a render loop
 * would otherwise report thousands of identical failures, which is a denial of
 * service written by us and aimed at ourselves.
 */

const MAX_REPORTS_PER_SESSION = 10;
const MAX_MESSAGE = 200;

let sent = 0;
const alreadySeen = new Set<string>();

function routeOf(): string {
  try {
    // Pathname only. The query is the private part.
    return window.location.pathname;
  } catch {
    return '/';
  }
}

function report(message: string, status?: number) {
  if (sent >= MAX_REPORTS_PER_SESSION) return;
  const text = String(message || '').slice(0, MAX_MESSAGE);
  if (!text) return;
  // The same failure firing in a loop is one fact, not five hundred.
  const key = `${text}|${status ?? ''}`;
  if (alreadySeen.has(key)) return;
  alreadySeen.add(key);
  sent += 1;
  try {
    const body = JSON.stringify({ route: routeOf(), message: text, status });
    /* sendBeacon survives the page being closed, which is exactly when a fatal
       error tends to happen. fetch with keepalive is the fallback; a plain fetch
       would be cancelled by the navigation it is trying to describe. */
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon('/api/diagnostics', new Blob([body], { type: 'application/json' }));
      return;
    }
    void fetch('/api/diagnostics', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      // Reporting a failure must never itself become one.
    });
  } catch {
    // Same.
  }
}

let installed = false;

/** Start reporting. Safe to call more than once; only the first call binds. */
export function reportPokeGuys() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  window.addEventListener('error', (event) => {
    // A failed <img> or <script> raises this too, with no message worth sending.
    const message = event?.message || (event?.target as HTMLElement | null)?.tagName;
    report(message ? `uncaught: ${message}` : 'uncaught: resource failed to load');
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event?.reason;
    report(`unhandled rejection: ${reason?.message || reason?.name || 'unknown'}`);
  });
}

/** Report a failure the application already caught and handled. */
export function reportHandled(message: string, status?: number) {
  report(`handled: ${message}`, status);
}
