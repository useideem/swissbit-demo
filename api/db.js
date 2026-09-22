/**
 * api/db.js -- Server-side proxy to the Ideem user API
 *
 * The user API at sbit.authconcepts.com:3033 sends no CORS headers, so a
 * browser refuses to let our pages call it. This function forwards
 * /db/<anything> to it from the server, where the same-origin rule does not
 * apply, and hands the answer back unchanged. dev-server.mjs does exactly the
 * same for local testing, so pages fetch the relative path ./db/... and work
 * on localhost, through a tunnel, and on Vercel without a change.
 *
 * WHY A FUNCTION AND NOT A PLAIN REWRITE: Vercel documents rewrites to
 * external origins, but says nothing about a non-standard port in the
 * destination. A port is fine for a server-side fetch, so this route leaves
 * nothing undocumented in the path.
 *
 * WHY ONE FLAT FILE AND NOT api/db/[...path].js: measured on a deployment,
 * the catch-all matched a single path segment only -- /api/db/users worked
 * while /api/db/users/9999 returned Vercel's own NOT_FOUND. So the rewrite in
 * vercel.json hands the rest of the path over in ?path= instead, and this
 * file's name contains nothing dynamic.
 *
 * NO AUTHENTICATION is involved: the upstream has none. Anything reachable
 * here is reachable by anyone who finds the deployment, exactly as it already
 * is on the upstream itself.
 */

/** Upstream user API. Override with the DB_API environment variable. */
const DB_API = process.env.DB_API || 'https://sbit.authconcepts.com:3033/api';

const ALLOWED_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE'];

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (!ALLOWED_METHODS.includes(request.method)) {
      return json({ error: `Method ${request.method} is not proxied` }, 405);
    }

    const target = DB_API + upstreamPath(url) + upstreamQuery(url);

    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    try {
      const upstream = await fetch(target, {
        method: request.method,
        headers: hasBody
          ? { 'Content-Type': request.headers.get('content-type') || 'application/json' }
          : {},
        body: hasBody ? await request.text() : undefined
      });
      const text = await upstream.text();
      return new Response(text, {
        status: upstream.status,
        headers: {
          'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
          'Cache-Control': 'no-store'
        }
      });
    } catch (err) {
      return json({ error: 'Upstream user API unreachable', detail: err.message }, 502);
    }
  }
};

/**
 * Works out which upstream path was asked for. The rewrite passes it in
 * ?path=, but a request that reaches this file directly carries it in the
 * pathname instead, so both are accepted.
 */
function upstreamPath(url) {
  const fromQuery = url.searchParams.get('path');
  if (fromQuery) return '/' + fromQuery.replace(/^\/+/, '');
  return url.pathname.replace(/^\/(?:api\/)?db/, '');
}

/** Everything the caller sent except the path parameter the rewrite adds. */
function upstreamQuery(url) {
  const params = new URLSearchParams(url.search);
  params.delete('path');
  const query = params.toString();
  return query ? '?' + query : '';
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
