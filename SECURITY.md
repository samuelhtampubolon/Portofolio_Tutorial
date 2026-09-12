# Security

## Reporting something

Open an issue at
[github.com/samuelhtampubolon/Portofolio_Tutorial/issues](https://github.com/samuelhtampubolon/Portofolio_Tutorial/issues).
There is no server, no user account and no stored user data anywhere but the
machine the application is running on, so there is no incident response to
co-ordinate and nothing gained by reporting privately first. A public issue gets
it fixed faster.

---

## Threat model

Being specific about this is the difference between security work and security
theatre. Most of the standard web threat model does not apply here, and saying
so is more useful than a checklist of mitigations for attacks that cannot happen.

**What does not exist:** no server, no database, no accounts, no sessions, no
cookies, no authentication, no authorisation, no multi-tenancy, no uploads, no
outbound requests. There is nothing to phish, no session to fix, no token to
steal, no SQL to inject, no SSRF target and no privilege to escalate to.

**What does exist, and is the whole of the attack surface:** this application
opens files that other people wrote. A `.tcad` document, an STL, an OBJ, a DXF,
a design-intent JSON, a pasted spec, a typed instruction. Every one of those is
untrusted input that is parsed and then used to build geometry and render text.

So the four things that could actually go wrong:

| | Attack | Defence |
|---|---|---|
| 1 | A crafted file executes script in the page | No dynamic code execution anywhere; every rendered value escaped; a Content-Security-Policy with no `unsafe-inline` |
| 2 | A crafted file corrupts the object model | Prototype pollution closed at every parse boundary; a null-prototype expression scope |
| 3 | A crafted file hangs or crashes the tab | Every catalogue parameter clamped at load; segment products capped; the expression parser bounded |
| 4 | A crafted file reads something it should not | Nothing is read but what the user opens; in the desktop build, path containment on the resolved path plus an extension allowlist |

Each is tested as a live attack in `tools/tests/security.mjs`, and the desktop
build's own surface in `tools/tests/desktop.mjs`. An audit is a snapshot; those
suites are a ratchet.

---

## What is enforced, and how to check it

### Content-Security-Policy

`index.html` carries `default-src 'none'` with every directive narrowed to this
origin. This is what turns "this application makes no network calls" from a
sentence in a README into something the browser guarantees.

```
default-src 'none';
script-src 'self' 'sha256-…';   one hash, for the inline import map
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
connect-src 'self' data: blob:;   no http or https origin at all
worker-src 'self' blob:;
form-action 'none'; base-uri 'none'; object-src 'none';
```

`connect-src` permits no network origin, so a telemetry call could not leave
even if one were added by mistake. `script-src` allows neither `unsafe-inline`
nor `unsafe-eval`.

**Check it yourself.** Open the developer tools, reload, and look at the network
panel: after the first visit there is nothing there. Then try to inject a script
from the console:

```js
const s = document.createElement('script');
s.textContent = 'window.x = 1';
document.body.appendChild(s);
window.x;              // undefined: the policy refused it
await fetch('https://example.com');   // rejected before a packet leaves
```

The one inline script is the import map, which must be inline to apply to the
modules that follow it, and is pinned by a SHA-256 hash. A stale hash breaks the
whole application, so it is computed rather than remembered:
`node tools/check-csp.mjs` verifies it and runs as part of `npm test`.

### What this deployment does *not* protect against

`frame-ancestors` and `X-Frame-Options` can only be delivered as HTTP headers,
and GitHub Pages serves no custom headers. **Clickjacking is therefore not
prevented on the hosted copy.** That is a real gap and it is named here rather
than omitted.

If you serve your own copy behind any ordinary web server, add:

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Cross-Origin-Opener-Policy: same-origin
```

The desktop build already sends all of these, because there it controls the
server. That asymmetry is why the desktop build is the more locked-down of the
two.

### No dynamic code execution

The expression engine is a hand-written tokeniser and recursive-descent parser.
It exists precisely so that a dimension typed as `width * 2`, or arriving inside
a file, is never handed to `eval` or `Function`. The security suite asserts that
**no file in the project** contains `eval(`, `new Function(`, `Function(`, or a
string-bodied timer, and that assertion covers the test suites too.

### Validation at the trust boundary

The feature catalogue declares `min` and `max` for every numeric field. Those
are enforced in `migrate()`, which every document passes through however it
arrived, rather than in the inspector widget. Before this, the limits were a
hint to one widget and a hand-edited file skipped them entirely.

Segment counts multiply, so the product is capped as well as each factor. A
`select` field cannot be set to a value outside its options. Non-finite numbers
fall back to the catalogue default. Expressions are left alone, because a string
cannot be range-checked without evaluating it, and the engine already refuses a
non-finite result by name at build time.

### Prototype pollution

Closed at every parse boundary and tested by four separate routes: a `__proto__`
key in feature parameters, a `constructor.prototype` payload, a `__proto__` on
the document root, and one nested inside a transform. The expression scope is
`Object.create(null)`, so a parameter can never be named after something on
`Object.prototype`, and the parser guards every lookup with `hasOwnProperty`, so
`toString` and `constructor` are not reachable as names.

---

## Your data

All of it stays on your machine. There is nowhere else for it to go.

| Stored | What it is |
|---|---|
| `tessercad.autosave.v3` | the document you have open |
| `tessercad.vcs.v1` | saved versions and branches |
| `tessercad.studio.v1` | standards, decisions, macros |
| `tessercad.prefs.v1` | preferences |
| `tessercad.why.v1` | which engineering notes you have seen |

Browser local storage, on this machine, readable by you and by nothing else.
**Help → Offline and ownership** lists it with sizes and will delete all of it.

Two things worth knowing. Clearing your browser data clears this too, so a
document you care about belongs in a saved file as well. And local storage is
not encrypted: anyone with access to your user account on your machine can read
it, exactly as they could read any file you saved.

---

## The desktop build

### Why the binary is not in the repository

A committed `.exe` is a blob nobody can review, cannot be traced to the source
it came from, and has to be trusted on the word of whoever pushed it. Built by
CI instead, every artefact comes from a commit anyone can read, by a workflow
anyone can read, on a runner nobody controls, with a SHA-256 published beside
it. That is strictly better for the person downloading it.

`.github/workflows/desktop.yml` runs the full test suite before packaging
anything, because a desktop build of a broken application is worse than none.

### It is not code-signed

Windows SmartScreen will warn you, and macOS Gatekeeper will refuse the `.dmg`
until you allow it explicitly. A code-signing certificate costs money and is
tied to an identity; a self-signed one changes nothing except teaching people to
click through warnings, which makes them less safe rather than more.

**Verify the download instead.** Every release has a `.sha256` beside it:

```powershell
Get-FileHash TesserCAD-1.0.0-portable.exe -Algorithm SHA256
```

```bash
sha256sum TesserCAD-1.0.0-portable.exe
```

Compare against the published hash, and against the value in the workflow log
for the run that built it. If they match, the file is the one built from the
commit that run names. If you would rather not run an unsigned binary at all,
that is a reasonable position: the hosted version is the same application and
needs nothing installed.

### The shell's posture

The desktop build is a browser window with the browser taken away, which means
the browser's sandbox is no longer doing the work and the shell has to. It is
configured as strictly as Electron allows, not as its defaults suggest:

| Setting | Value | Why |
|---|---|---|
| `sandbox` | on | The renderer runs in an OS-level sandbox |
| `contextIsolation` | on | Page scripts cannot reach Electron's internals |
| `nodeIntegration` | off | Without this, an XSS is not a script injection, it is arbitrary code execution on your machine |
| `nodeIntegrationInWorker` | off | The same, for the boolean workers |
| `webSecurity` | on | Same-origin policy applies; the app's own CSP is served with the page |
| `webviewTag` | off | Nothing needs it, and it is an embedding surface |
| `navigateOnDragDrop` | off | Dropping a file cannot navigate the window |
| preload script | none | There is nothing the page needs from the host, so there is no bridge to audit |

Navigation and window creation are refused outright; a CAD application has no
reason to follow a link to another origin, and `https://` links are handed to
your real browser instead. Every permission request is denied: no camera, no
microphone, no geolocation, no notifications.

The application is served over a loopback HTTP server bound to `127.0.0.1`
rather than `file://`, for two reasons. ES modules and the import map need an
HTTP origin. And under `file://` every local file is same-origin with the page,
which is a worse position than the one this avoids.

That server is the only code in the desktop build that turns an untrusted string
into a filesystem read, so it lives in `desktop/serve.cjs` separately from the
Electron shell specifically so it can be tested. Containment is checked on the
**resolved, normalised** path, which is the only form of the check that holds:
`..` segments, percent-encoded separators, double-encoded separators, backslashes
and absolute paths all collapse before the comparison. An extension allowlist is
a second, independent barrier, so a `.pem` or a `.env` inside the tree is refused
even though it resolves inside it. Fourteen traversal encodings are attacked
directly in `tools/tests/desktop.mjs`, and two more over a real socket.

The developer tools are deliberately left enabled. An application claiming your
data never leaves the machine should let anyone open the network panel and
confirm it.

---

## Dependencies

Runtime: **one**, vendored. three.js r169, unmodified, MIT, with its licence at
`vendor/THREE-LICENSE.txt`. Nothing is fetched at runtime, and the CSP would
refuse it if it were.

`npm install` for the web application downloads nothing: `node_modules/three` is
a shim pointing at `vendor/`, created by `tools/setup-dev.mjs` so Node can run
the test suites against the same files the browser loads. There is no bundler, no
transpiler and no build step, which means the code you audit is the code that
runs — there is no output artefact in which something could differ.

The desktop shell has two development dependencies, `electron` and
`electron-builder`, installed only on the CI runner that packages a release.
They never reach a user's machine as source, and the web application does not
depend on them at all.

---

## Verifying the whole claim

```bash
npm test                          # 854 checks, 16 suites, ~4 seconds
node tools/tests/security.mjs     # the attacks, on their own
node tools/tests/desktop.mjs      # the desktop surface
node tools/check-csp.mjs          # the policy's hash is current
```

Nothing in that requires a network, an account or a build.
