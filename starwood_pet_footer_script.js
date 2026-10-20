/**
 * Starwood attribution
 *
 * Builds a "touch" each time a visitor enters the site (a page load with tracked URL params,
 * an external referrer, or neither = direct). With HubSpot banner consent, first and latest
 * touch are stored in root-domain cookies. Without consent, the touch is carried page to page
 * on internal link URLs instead. Quote app links are decorated with the active touch.
 * Replaces the previous inline quote link script.
 *
 * Cookies (URL-encoded JSON, 90 days, Domain=.starwoodpet.com):
 *   swp_ft  first touch, never overwritten
 *   swp_lt  latest touch, overwritten by any non-direct entry (direct only fills it when empty)
 *
 * Touch fields (empty fields are omitted):
 *   source, medium      resolved channel, e.g. google/ppc, google/organic, direct/none
 *   source_type         utm | click_id | referrer | direct
 *   campaign            utm_campaign
 *   term                utm_term
 *   content             utm_content
 *   campaign_id         utm_id
 *   gclid, gbraid, wbraid, msclkid, fbclid
 *   hsa_*               HubSpot ad params, names unchanged (hsa_cam, hsa_grp, hsa_ad, hsa_kw, ...)
 *   other               any other utm_* params, as { name: value }
 *   referrer            external referrer (origin + path), empty for direct
 *   landing_page        entry page (origin + path)
 *   captured_at         ISO 8601
 *
 * Quote app links receive:
 *   utm_* (utm_source/utm_medium only when source_type is utm), click IDs, hsa_*,
 *   swp_source, swp_medium, swp_source_type, swp_referrer, swp_landing_page,
 *   and referrer=<current www page URL>.
 *
 * Browser support: ES2022 (current Chrome, Edge, Safari, Firefox). No build step required.
 * Tests: starwood-attribution.test.js (node --test).
 */
(() => {
  'use strict';

  const CONFIG = {
    quoteHosts: ['app.starwoodpet.com', 'app.petairuk.com'],
    quotePaths: ['/quote-router', '/quote-request'], // also matches trailing slash and sub-paths
    rootDomains: ['starwoodpet.com', 'petairuk.com'],
    firstTouchCookie: 'swp_ft',
    latestTouchCookie: 'swp_lt',
    maxAgeDays: 90,
    maxValueLength: 200,
    maxCookieLength: 3800,
    consentCategory: 'advertisement', // HubSpot banner category: advertisement | analytics | functionality
    directOverwritesLatest: false,    // true = a direct visit replaces an existing latest touch
    carryWithoutConsent: true,        // carry the touch on internal links when cookies are not allowed
    debug: false
  };

  const UTM_FIELDS = {
    utm_campaign: 'campaign',
    utm_term: 'term',
    utm_content: 'content',
    utm_id: 'campaign_id'
  };

  const CLICK_IDS = ['gclid', 'gbraid', 'wbraid', 'msclkid', 'fbclid'];

  const CLICK_ID_CHANNEL = {
    gclid: ['google', 'cpc'],
    gbraid: ['google', 'cpc'],
    wbraid: ['google', 'cpc'],
    msclkid: ['bing', 'cpc'],
    fbclid: ['facebook', 'social']
  };

  // URL params used to carry the resolved touch between pages and to the app
  const CARRY = {
    swp_source: 'source',
    swp_medium: 'medium',
    swp_source_type: 'source_type',
    swp_referrer: 'referrer',
    swp_landing_page: 'landing_page'
  };

  const SKIP_HREF = /^(#|mailto:|tel:|sms:|javascript:)/i;

  const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Keys ending in "." match any TLD (google.co.uk). Others match the domain and its subdomains.
  const hostPattern = (key) => key.endsWith('.')
    ? new RegExp(`(^|\\.)${escapeRegExp(key)}`)
    : new RegExp(`(^|\\.)${escapeRegExp(key)}$`);

  // Referrer classification, checked in order. Anything unmatched is referral.
  const REFERRER_RULES = Object.entries({
    ai: {
      'chatgpt.com': 'chatgpt', 'chat.openai.com': 'chatgpt', 'perplexity.ai': 'perplexity',
      'claude.ai': 'claude', 'gemini.google.com': 'gemini', 'copilot.microsoft.com': 'copilot'
    },
    social: {
      'facebook.com': 'facebook', 'instagram.com': 'instagram', 'linkedin.com': 'linkedin',
      'lnkd.in': 'linkedin', 't.co': 'x', 'x.com': 'x', 'twitter.com': 'x', 'pinterest.': 'pinterest',
      'youtube.com': 'youtube', 'reddit.com': 'reddit', 'tiktok.com': 'tiktok'
    },
    organic: {
      'google.': 'google', 'bing.com': 'bing', 'yahoo.': 'yahoo', 'duckduckgo.com': 'duckduckgo',
      'ecosia.org': 'ecosia', 'search.brave.com': 'brave', 'baidu.com': 'baidu', 'yandex.': 'yandex'
    }
  }).flatMap(([medium, hosts]) =>
    Object.entries(hosts).map(([key, source]) => ({ medium, source, pattern: hostPattern(key) }))
  );

  const state = {
    consent: false,
    current: null, // touch for this page load
    latest: null   // cached swp_lt cookie, only populated with consent
  };

  const log = (...args) => {
    if (CONFIG.debug) console.log('[swp-attribution]', ...args);
  };

  const compact = (obj) =>
    Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== '' && v != null));

  // --- Domains and referrers ---

  const getRootDomain = (host) => {
    const h = String(host || '').toLowerCase();
    return CONFIG.rootDomains.find((d) => h === d || h.endsWith(`.${d}`)) || null;
  };

  // Origin + path of an external referrer, or '' when there is none or it is internal.
  const externalReferrer = () => {
    if (!document.referrer) return '';
    try {
      const r = new URL(document.referrer);
      const refRoot = getRootDomain(r.hostname);
      const pageRoot = getRootDomain(location.hostname);
      const internal = refRoot && pageRoot ? refRoot === pageRoot : r.hostname === location.hostname;
      return internal ? '' : r.origin + r.pathname;
    } catch {
      return '';
    }
  };

  const classifyReferrer = (refUrl) => {
    const host = new URL(refUrl).hostname.toLowerCase();
    const rule = REFERRER_RULES.find((r) => r.pattern.test(host));
    return rule ? [rule.source, rule.medium] : [host.replace(/^www\./, ''), 'referral'];
  };

  // --- Touch building ---

  const isTrackedKey = (k) =>
    CLICK_IDS.includes(k) || k.startsWith('utm_') || k.startsWith('hsa_');

  const readUrl = (url) => {
    const tracked = {};
    const carried = {};
    try {
      for (const [key, value] of new URL(url).searchParams) {
        const k = key.toLowerCase();
        if (!value) continue;
        const v = value.slice(0, CONFIG.maxValueLength);
        if (Object.hasOwn(CARRY, k)) {
          if (!Object.hasOwn(carried, k)) carried[k] = v;
        } else if (isTrackedKey(k) && !Object.hasOwn(tracked, k)) {
          tracked[k] = v;
        }
      }
    } catch {
      // malformed URL, nothing captured
    }
    return { tracked, carried };
  };

  const resolveChannel = (tracked, ref) => {
    if (tracked.utm_source || tracked.utm_medium) {
      return { source: tracked.utm_source || '', medium: tracked.utm_medium || '', type: 'utm' };
    }
    const clickId = CLICK_IDS.find((id) => tracked[id]);
    if (clickId) {
      const [source, medium] = CLICK_ID_CHANNEL[clickId];
      return { source, medium, type: 'click_id' };
    }
    if (ref) {
      const [source, medium] = classifyReferrer(ref);
      return { source, medium, type: 'referrer' };
    }
    return { source: 'direct', medium: 'none', type: 'direct' };
  };

  // Touch for this page load, or null when the visitor is browsing internally
  // and nothing was carried over (not a new entry).
  const buildTouch = () => {
    const { tracked, carried } = readUrl(location.href);
    const hasTracked = Object.keys(tracked).length > 0;
    const hasCarried = Boolean(carried.swp_source);
    const ref = externalReferrer();

    if (!hasTracked && !hasCarried && document.referrer && !ref) return null;

    const touch = {};

    for (const [k, v] of Object.entries(tracked)) {
      if (k === 'utm_source' || k === 'utm_medium') continue;
      if (Object.hasOwn(UTM_FIELDS, k)) {
        touch[UTM_FIELDS[k]] = v;
      } else if (CLICK_IDS.includes(k) || k.startsWith('hsa_')) {
        touch[k] = v;
      } else {
        touch.other = { ...touch.other, [k]: v };
      }
    }

    if (hasCarried) {
      for (const [param, field] of Object.entries(CARRY)) {
        if (carried[param]) touch[field] = carried[param];
      }
    } else {
      const { source, medium, type } = resolveChannel(tracked, ref);
      Object.assign(touch, {
        source,
        medium,
        source_type: type,
        referrer: ref,
        landing_page: location.origin + location.pathname
      });
    }

    touch.captured_at = new Date().toISOString();
    return compact(touch);
  };

  const DIRECT_TOUCH = Object.freeze({ source: 'direct', medium: 'none', source_type: 'direct' });

  // Touch to URL params as [name, value] pairs. A null touch is sent as direct.
  const touchToParams = (touch) => {
    const t = touch || DIRECT_TOUCH;
    const out = [];

    if (t.source_type === 'utm') {
      if (t.source) out.push(['utm_source', t.source]);
      if (t.medium) out.push(['utm_medium', t.medium]);
    }
    for (const [param, field] of Object.entries(UTM_FIELDS)) {
      if (t[field]) out.push([param, t[field]]);
    }
    for (const id of CLICK_IDS) {
      if (t[id]) out.push([id, t[id]]);
    }
    for (const [k, v] of Object.entries(t)) {
      if (k.startsWith('hsa_')) out.push([k, v]);
    }
    if (t.other) out.push(...Object.entries(t.other));
    for (const [param, field] of Object.entries(CARRY)) {
      if (t[field]) out.push([param, t[field]]);
    }
    return out;
  };

  // --- Cookies ---

  const encodeTouch = (obj) => encodeURIComponent(JSON.stringify(obj));

  // Returns true when the cookie was written.
  const setCookie = (name, obj) => {
    let value = encodeTouch(obj);
    if (value.length > CONFIG.maxCookieLength) {
      const { other, referrer, landing_page, ...essential } = obj;
      value = encodeTouch(essential);
      if (value.length > CONFIG.maxCookieLength) {
        log('cookie too large, skipped', name);
        return false;
      }
    }
    const parts = [
      `${name}=${value}`,
      `Max-Age=${CONFIG.maxAgeDays * 86400}`,
      'Path=/',
      'SameSite=Lax'
    ];
    const root = getRootDomain(location.hostname);
    if (root) parts.push(`Domain=.${root}`);
    if (location.protocol === 'https:') parts.push('Secure');
    document.cookie = parts.join('; ');
    log('cookie set', name, obj);
    return true;
  };

  const getCookie = (name) => {
    const entry = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));
    if (!entry) return null;
    try {
      return JSON.parse(decodeURIComponent(entry.slice(name.length + 1)));
    } catch {
      return null;
    }
  };

  const deleteCookie = (name) => {
    const base = `${name}=; Max-Age=0; Path=/`;
    document.cookie = base;
    const root = getRootDomain(location.hostname);
    if (root) document.cookie = `${base}; Domain=.${root}`;
  };

  const persist = () => {
    const cur = state.current;
    if (!state.consent || !cur) return;
    if (!getCookie(CONFIG.firstTouchCookie)) setCookie(CONFIG.firstTouchCookie, cur);
    const isDirect = cur.source_type === 'direct';
    if (!isDirect || CONFIG.directOverwritesLatest || !state.latest) {
      if (setCookie(CONFIG.latestTouchCookie, cur)) state.latest = cur;
    }
  };

  const clearStored = () => {
    deleteCookie(CONFIG.firstTouchCookie);
    deleteCookie(CONFIG.latestTouchCookie);
    state.latest = null;
    log('cookies cleared');
  };

  // Non-direct current touch wins, then the latest touch cookie, then the current (direct) touch.
  const getActiveTouch = () => {
    const cur = state.current;
    if (cur && cur.source_type !== 'direct') return cur;
    return (state.consent && state.latest) || cur;
  };

  // --- Link decoration ---

  const isQuoteLink = (u) => {
    if (!CONFIG.quoteHosts.includes(u.hostname.toLowerCase())) return false;
    const path = u.pathname.toLowerCase();
    return CONFIG.quotePaths.some((p) => path === p || path.startsWith(`${p}/`));
  };

  // Internal page links carry the touch only when cookies are not allowed.
  // Direct touches are not carried. A page with nothing carried is treated as direct.
  const shouldCarry = (u) => {
    const cur = state.current;
    if (!CONFIG.carryWithoutConsent || state.consent || !cur || cur.source_type === 'direct') return false;
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (u.hostname !== location.hostname) return false;
    if (u.pathname === location.pathname && u.hash) return false; // same-page anchor
    return true;
  };

  const appendParams = (u, params) => {
    for (const [k, v] of params) {
      if (!u.searchParams.has(k)) u.searchParams.set(k, v);
    }
  };

  // Decorated href for a link. Params already on the link are kept.
  const buildHref = (href, pageUrl = location.href) => {
    try {
      const u = new URL(href, pageUrl);
      if (isQuoteLink(u)) {
        appendParams(u, touchToParams(getActiveTouch()));
        if (!u.searchParams.has('referrer')) u.searchParams.set('referrer', pageUrl);
        return u.toString();
      }
      if (shouldCarry(u)) {
        appendParams(u, touchToParams(state.current));
        return u.toString();
      }
      return href;
    } catch {
      return href;
    }
  };

  // Always rebuilds from the original href, so consent changes are reflected.
  const decorate = (a) => {
    if (!a?.getAttribute) return;
    const stored = a.getAttribute('data-swp-href');
    const original = stored ?? a.getAttribute('href');
    if (!original || SKIP_HREF.test(original)) return;
    const next = buildHref(original);
    if (next === original && stored === null) return;
    if (stored === null) a.setAttribute('data-swp-href', original);
    a.setAttribute('href', next);
  };

  const decorateAll = () => {
    for (const a of document.querySelectorAll('a[href]')) decorate(a);
  };

  // Covers links rendered after load. mousedown includes middle and right click.
  const onInteract = (e) => decorate(e.target?.closest?.('a'));

  // --- HubSpot consent ---

  const hasConsent = (consent) => {
    if (!consent) return false;
    const granted = consent.categories?.[CONFIG.consentCategory];
    return typeof granted === 'boolean' ? granted : Boolean(consent.allowed);
  };

  const _hsp = (window._hsp = window._hsp || []);
  _hsp.push(['addPrivacyConsentListener', (consent) => {
    state.consent = hasConsent(consent);
    log('consent', state.consent, consent);
    if (state.consent) {
      state.latest = getCookie(CONFIG.latestTouchCookie);
      persist();
    } else {
      clearStored();
    }
    decorateAll();
  }]);

  // --- Init ---

  state.current = buildTouch();
  log('touch', state.current);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', decorateAll);
  } else {
    decorateAll();
  }

  document.addEventListener('mousedown', onInteract, true);
  document.addEventListener('touchstart', onInteract, { capture: true, passive: true });
  document.addEventListener('click', onInteract, true);

  window.__buildQuoteHref = buildHref;
  window.__swpAttribution = Object.freeze({
    firstTouch: () => getCookie(CONFIG.firstTouchCookie),
    latestTouch: () => getCookie(CONFIG.latestTouchCookie),
    current: () => state.current,
    hasConsent: () => state.consent
  });
})();