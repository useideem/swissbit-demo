/**
 * api/db/[...path].js -- Server-side proxy to the Ideem user API
 *
 * The user API at sbit.authconcepts.com:3033 sends no CORS headers, so a
 * browser refuses to let our pages call it. This function forwards
 * /db/<anything> to it from the server, where the same-origin rule does not
 * apply, and hands the answer back unchanged. dev-server.mjs does exactly the
 * same for local testing, so pages fetch the relative path ./db/... and work
 * on localhost, through a tunnel, and on Vercel without a change.
 *
 * /db/... reaches this file through the rewrite in vercel.json. The path is
 * stripped defensively so the function behaves the same whether it sees the
 * original path or the rewritten one.
 *
 * WHY A FUNCTION AND NOT A PLAIN REWRITE: Vercel documents rewrites to
 * external origins, but says nothing about a non-standard port in the
 * destination. A port is fine for a server-side fetch, so this route leaves
 * nothing undocumented in the path.
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

    // Accept either the original /db/... or the rewritten /api/db/...
    const suffix = url.pathname.replace(/^\/(?:api\/)?db/, '');
    const target = DB_API + suffix + url.search;

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

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
