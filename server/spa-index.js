// server/spa-index.js (PRO127): the dashboard page served for a nested route such as /dashboard/home/map.
// The page's relative CSS/JS links must resolve against /dashboard/, not the nested path. A <base> added by
// script comes too late: the browser's preload scanner has already requested ./styles/... under the nested
// path (25 failed requests per load). So the server writes the <base> into the HTML it sends.
//
//   baseHrefFor(pathname)      -> '/x/dashboard/' for any path under a '/dashboard' segment, else '/dashboard/'
//   withBase(html, pathname)   -> html with <base href> as the first element of <head> (unchanged if one exists)

export function baseHrefFor(pathname) {
  const m = String(pathname || '').match(/^(.*?\/dashboard)(?:\/|$)/);
  return `${m ? m[1] : '/dashboard'}/`;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function withBase(html, pathname) {
  if (/<base\s/i.test(html)) return html;
  return html.replace(/<head>/i, (h) => `${h}\n  <base href="${esc(baseHrefFor(pathname))}">`);
}
