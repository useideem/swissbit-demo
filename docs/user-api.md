# The Ideem user API

The demo's user records live in an Express service at
`https://sbit.authconcepts.com:3033/api`, database `Authenticate2026`. The
enrollment page writes to it; the retrieval side reads from it, keyed by the
phone number the iShield Key hands back.

Everything below was measured against the live service on 2026-09-22, not read
off the Postman collection, which carries no saved responses and no bodies for
its PUT requests.

---

## 1. The record

```json
{
  "userId": 1,
  "firstName": "Chris",
  "lastName": "Test",
  "phone": "512-555-1234",
  "balance": 1250.5,
  "photo": null,
  "customAttrib": "Demo user"
}
```

`userId` is assigned by the server; a create body leaves it out. `photo` has
been null in every record so far, so its format is still unknown.

## 2. Endpoints

| Method | Path | Answers with |
|---|---|---|
| GET | `/health` | `{"status":"OK","database":"Authenticate2026"}` |
| POST | `/users` | **201** and the created record, `userId` included |
| GET | `/users` | array of every record |
| GET | `/users/:id` | a single **object** |
| GET | `/users/phone/:phone` | an **array**, one element per match |
| PUT | `/users/:id`, `/users/phone/:phone` | 200 and the updated record |
| DELETE | `/users/:id`, `/users/phone/:phone` | `{"message":"User deleted","user":{…}}` |

A missing record gives `404 {"error":"User not found"}`. An unknown route
gives Express's HTML error page, not JSON.

Note the shape difference: a by-id read returns an object, a by-phone read
returns an array. Code that handles both has to unwrap.

## 3. Four behaviours worth knowing

**Phone lookup is an exact string match.** `/users/phone/512-555-1234` finds
the seeded record; `/users/phone/5125551234` returns 404. There is no
normalisation on the server, so the whole demo has to agree on one spelling.
**Ours is bare digits** -- on the key, in the database, and in the lookup.
Format for display only.

**PUT replaces, it does not merge.** A body of `{"firstName":"Renamed"}`
against an existing user returns `500 {"error":"Failed to update user"}` and
changes nothing. Send every field.

**Phone numbers are not unique.** Two POSTs with the same number produce two
records with different `userId`s. Nothing on the server prevents it, so
`enroll.js` looks the number up first and PUTs when it already exists.

**There is no authentication.** No key, no token, no session. Anyone who knows
the URL can read, edit and delete every record, `balance` included. Fine for a
booth demo with invented data; do not put anything real in it.

## 4. CORS, and why the proxy exists

The service sends **no `Access-Control-Allow-Origin` header**, on any method.
A preflight `OPTIONS` returns Express's default `Allow: GET, HEAD, POST` with
no CORS headers at all. So a browser will not let our pages call it directly,
whatever origin they are served from.

Rather than ask for a server change -- which would also need an allow-list
covering localhost, a tunnel hostname that changes every run, the Vercel
domain and any future custom domain -- the site proxies the API from its own
origin. Pages fetch the relative path `./db/...` and the same code works
everywhere:

| Where | What forwards `/db/*` |
|---|---|
| Local | `dev-server.mjs`, in `handleDb` |
| Vercel | `api/db.js`, reached by the rewrite in `vercel.json` |

Both take `DB_API` from the environment to point somewhere else.

**A catch-all function file does not work here.** The first attempt put the
proxy in `api/db/[...path].js`, and on a real deployment that matched exactly
one path segment: `/api/db/users` answered, `/api/db/users/9999` and
`/api/db/users/phone/…` returned Vercel's own `NOT_FOUND` page rather than the
upstream's 404. The fix is a flat `api/db.js` with nothing dynamic in the
name, and a rewrite that hands the rest of the path over as a query
parameter:

```json
{ "source": "/db/:path*", "destination": "/api/db?path=:path*" }
```

The function reads the path from `?path=` and falls back to the pathname, so
it behaves the same when called directly.

**The function's source is readable.** Because `outputDirectory` is `.`, the
whole repository is the static root, so `/api/db.js` serves its own source
over HTTP. Nothing in it is secret -- the upstream URL is in the Postman
collection anyway and there are no credentials anywhere in this repo -- but it
is worth knowing before anything sensitive goes in that file.

A plain Vercel rewrite straight to the upstream was the obvious alternative and
was deliberately not used: external rewrite destinations are documented, but
Vercel documents nothing about a **non-standard port** such as `:3033` in a
destination. It passes schema validation and survives the build-time
transform, so it would not fail at build -- it would fail silently at runtime
if the edge proxy declines the port. A server-side `fetch` has no such
ambiguity.

## 5. Commands

```sh
curl -s https://sbit.authconcepts.com:3033/api/health
curl -s http://localhost:8080/db/users                  # through the local proxy
curl -s https://swissbit-ideem.vercel.app/db/users      # through the Vercel proxy
```
