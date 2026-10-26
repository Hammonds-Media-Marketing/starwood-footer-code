<!-- START Google Client ID Capture analyticsamplifier.io -->
<script>
(function() {
  function get_ga_clientid() {
    var cookies = {};
    document.cookie.split(";").forEach(function(e) {
      var parts = e.split("=");
      var name = parts[0].trim();
      var value = parts[1];
      cookies[name] = value;
    });
    return cookies._ga ? cookies._ga.substring(6) : "";
  }

  function setformfield(clientId) {
    if (!clientId) return;
    if (window.jQuery) {
      jQuery.noConflict()('input[name="google_client_id"]').val(clientId).change();
    } else {
      var el = document.querySelector("input[name='google_client_id']");
      if (el) el.value = clientId;
    }
  }

  function initGAClientIdCapture() {
    try {
      setTimeout(function() {
        setformfield(get_ga_clientid());
      }, 1000);
    } catch (e) {
      setTimeout(function() {
        setformfield(get_ga_clientid());
      }, 1000);
    }
    // Once it runs, remove the event listeners to avoid re-triggering
    document.removeEventListener('click', triggerInit);
    document.removeEventListener('mousemove', triggerInit);
    document.removeEventListener('scroll', triggerInit);
    document.removeEventListener('keydown', triggerInit);
  }

  function triggerInit() {
    initGAClientIdCapture();
  }

  // Wait for any user interaction
  document.addEventListener('click', triggerInit, { once: true });
  document.addEventListener('mousemove', triggerInit, { once: true });
  document.addEventListener('scroll', triggerInit, { once: true });
  document.addEventListener('keydown', triggerInit, { once: true });
})();
</script>
<!-- END Google Client ID Capture analyticsamplifier.io -->

<script>
(function () {
  var QUOTE_HOSTS = ['app.starwoodpet.com', 'app.petairuk.com'];
  var QUOTE_PATHS = ['/quote-router/', '/quote-request/'];
  var KEYS = ['gclid', 'gbraid', 'wbraid', 'msclkid',
              'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];

  function isQuoteLink(u) {
    return QUOTE_HOSTS.indexOf(u.hostname) !== -1 &&
           QUOTE_PATHS.indexOf(u.pathname) !== -1;
  }

  // Returns the link href with this page's attribution params appended, or the
  // original href if nothing applies. Params already on the link are kept.
  function buildHref(href, pageUrl) {
    try {
      var link = new URL(href, pageUrl);
      if (!isQuoteLink(link)) return href;
      var page = new URL(pageUrl);
      KEYS.forEach(function (k) {
        var v = page.searchParams.get(k);
        if (v && !link.searchParams.has(k)) link.searchParams.set(k, v);
      });
      if (!link.searchParams.has('referrer')) link.searchParams.set('referrer', pageUrl);
      return link.toString();
    } catch (e) {
      return href;
    }
  }

  function decorate(a) {
    if (!a || !a.getAttribute) return;
    var href = a.getAttribute('href');
    if (!href) return;
    var next = buildHref(href, window.location.href);
    if (next !== href) a.setAttribute('href', next);
  }

  function decorateAll() {
    var links = document.querySelectorAll('a[href*="/quote-router/"], a[href*="/quote-request/"]');
    for (var i = 0; i < links.length; i++) decorate(links[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', decorateAll);
  } else {
    decorateAll();
  }

  // Catch links rendered after load (menus, modals) right before navigation.
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a') : null;
    decorate(a);
  }, true);

  window.__buildQuoteHref = buildHref;
})();
</script>
