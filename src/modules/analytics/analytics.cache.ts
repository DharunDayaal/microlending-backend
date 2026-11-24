import type { Request, Response, NextFunction } from "express";

/**
 * Short-lived cache for analytics GET responses.
 *
 * Analytics queries are heavy and the dashboard fires many of them at once,
 * which can exhaust the DB pool. Here:
 *  - a successful response is reused for TTL_MS, per user and exact URL
 *    (so scope, filters and paging are all part of the key);
 *  - identical requests that arrive while the first is still running wait for
 *    it and share its result instead of running the same queries again.
 *
 * The cache lives in this server instance's memory only.
 * Any successful write (see clearAnalyticsCacheOnWrite) empties it.
 */

const TTL_MS = 60_000;
const MAX_ENTRIES = 500;

type Entry = { expires: number; status: number; body: unknown };

const done = new Map<string, Entry>();
const inflight = new Map<string, Promise<Entry | null>>();

function store(key: string, entry: Entry) {
  done.delete(key);
  if (done.size >= MAX_ENTRIES) {
    // Map keeps insertion order, so the first key is the oldest
    const oldest = done.keys().next().value;
    if (oldest !== undefined) done.delete(oldest);
  }
  done.set(key, entry);
}

export function clearAnalyticsCache() {
  done.clear();
}

export function analyticsCache(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (req.method !== "GET" || !req.user) return next();

  const { id, role, teamId } = req.user;
  const key = `${id}|${role}|${teamId}|${req.originalUrl}`;

  const hit = done.get(key);
  if (hit && hit.expires > Date.now()) {
    res.setHeader("X-Cache", "HIT");
    res.status(hit.status).json(hit.body);
    return;
  }
  if (hit) done.delete(key);

  const pending = inflight.get(key);
  if (pending) {
    // the same request is already running: wait for it, or run our own if it failed
    pending.then((entry) => {
      if (entry) {
        res.setHeader("X-Cache", "SHARED");
        res.status(entry.status).json(entry.body);
      } else {
        next();
      }
    });
    return;
  }

  let settled = false;
  let resolve!: (entry: Entry | null) => void;
  inflight.set(key, new Promise<Entry | null>((r) => (resolve = r)));

  const settle = (entry: Entry | null) => {
    if (settled) return;
    settled = true;
    inflight.delete(key);
    if (entry) store(key, entry);
    resolve(entry);
  };

  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    // only successes are cached; errors (e.g. a pool timeout) are retried by the next request
    settle(
      res.statusCode === 200
        ? { expires: Date.now() + TTL_MS, status: 200, body }
        : null,
    );
    return json(body);
  };
  // client went away or the response ended some other way: release any waiters
  res.on("close", () => settle(null));

  res.setHeader("X-Cache", "MISS");
  next();
}

/** Data changed on this instance: drop cached analytics so they are not stale. */
export function clearAnalyticsCacheOnWrite(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // logins, token refreshes and export jobs don't change analytics data
  const irrelevant = /^\/api\/(auth|exports|internal)(\/|\?|$)/.test(
    req.originalUrl,
  );
  if (
    !irrelevant &&
    req.method !== "GET" &&
    req.method !== "HEAD" &&
    req.method !== "OPTIONS"
  ) {
    res.on("finish", () => {
      if (res.statusCode < 400) clearAnalyticsCache();
    });
  }
  next();
}
