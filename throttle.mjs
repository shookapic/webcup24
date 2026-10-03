// Sliding-window failure limiter for sign-in (F37). In memory: a restart clears it, and it is per process.
// Three layers, so neither one guessing hard at one account nor one sweeping across many accounts gets through:
//   pair    ip + account   5 failures / 15 min   (a person mistyping their own password)
//   account any ip         20 failures / 15 min  (guessing spread over many addresses)
//   ip      any account    40 failures / 15 min  (credential stuffing across many accounts)
export const WINDOW = 15 * 60_000;

export class Limiter {
  constructor(limit, windowMs = WINDOW) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
  }

  recent(key, now = Date.now()) {
    const list = (this.hits.get(key) || []).filter((time) => now - time < this.windowMs);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  count(key, now) {
    return this.recent(key, now).length;
  }

  // Milliseconds until this key may try again (0 = not blocked): the moment the failure that put it
  // over the limit leaves the window.
  waitMs(key, now = Date.now()) {
    const list = this.recent(key, now);
    return list.length >= this.limit ? list[list.length - this.limit] + this.windowMs - now : 0;
  }

  add(key, now = Date.now()) {
    this.recent(key, now);
    this.hits.set(key, [...(this.hits.get(key) || []), now]);
  }

  reset(key) {
    this.hits.delete(key);
  }

  sweep(now = Date.now()) {
    for (const key of [...this.hits.keys()]) this.recent(key, now);
  }
}

export const pairs = new Limiter(5);
export const accounts = new Limiter(20);
export const addresses = new Limiter(40);

const events = [];

export function record(kind, account, now = Date.now()) {
  events.push({ at: now, kind, account });
  if (events.length > 500) events.splice(0, events.length - 500);
}

// Longest wait among the layers that block this attempt, 0 if none.
export function loginWait(ip, account, now = Date.now()) {
  return Math.max(pairs.waitMs(`${ip}|${account}`, now), accounts.waitMs(account, now), addresses.waitMs(ip, now));
}

export function loginFailed(ip, account, now = Date.now()) {
  pairs.add(`${ip}|${account}`, now);
  accounts.add(account, now);
  addresses.add(ip, now);
  record('failed', account, now);
  return Math.max(0, Math.min(pairs.limit - pairs.count(`${ip}|${account}`, now), accounts.limit - accounts.count(account, now)));
}

// Failures on this account that did NOT come from the address now signing in (the owner's own typos are
// not news to them). Counted before a success clears that address's counter.
export function loginSucceeded(ip, account, now = Date.now()) {
  const own = pairs.count(`${ip}|${account}`, now);
  pairs.reset(`${ip}|${account}`);
  return accounts.count(account, now) - own;
}

export function summary(now = Date.now()) {
  const recentEvents = events.filter((event) => now - event.at < WINDOW);
  const failures = new Map();
  for (const event of recentEvents) if (event.kind === 'failed') failures.set(event.account, (failures.get(event.account) || 0) + 1);
  return {
    windowMinutes: WINDOW / 60_000,
    failedLogins: recentEvents.filter((event) => event.kind === 'failed').length,
    blockedAttempts: recentEvents.filter((event) => event.kind === 'blocked').length,
    failures,
  };
}

setInterval(() => { for (const limiter of [pairs, accounts, addresses]) limiter.sweep(); }, 60_000).unref();
