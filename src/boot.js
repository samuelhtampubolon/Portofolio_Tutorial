/**
 * The entry point, as a file rather than an inline script.
 *
 * It exists so index.html can carry a Content-Security-Policy with no
 * `'unsafe-inline'` in `script-src`. An inline `<script>` would need either
 * that keyword, which would defeat the policy, or a hash that changes every
 * time the boot code changes. A file needs neither: `script-src 'self'`
 * covers it.
 *
 * The import map is the one inline script left, and it is allowed by its
 * sha256 hash. It cannot become a file: an import map has to be inline to
 * apply to the module graph that follows it.
 */
const failed = (message) => {
  const node = document.getElementById('bootMsg');
  if (node) {
    node.textContent = `Failed to load: ${message}`;
    node.style.color = '#ff6b6b';
  }
};

import('./main.js').catch((err) => {
  console.error(err);
  failed(err?.message || String(err));
});
