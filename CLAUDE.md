# Conventions for AI-assisted contributions

This repository is developed with AI assistance, which is disclosed in
[PROVENANCE.md](PROVENANCE.md) § 2. This file records the conventions that
assistance follows, so they hold across sessions rather than being restated
each time.

## Commit trailers

Commits carry exactly one attribution trailer:

```
Co-Authored-By: Claude <noreply@anthropic.com>
```

**Do not add a `Claude-Session:` trailer, or any other link to an assistant
session, to a commit message.** Such a URL resolves only for the account that
created the session, so it is unreadable to everyone who will ever read this
history. It records nothing about the change, and it ties a public repository
to a private session for no stated purpose. It is a dangling link, not
attribution, and attribution is already served by the trailer above and by
PROVENANCE.md.

The same applies to pull request descriptions.

## What the commit message is for

Commit subjects here state the problem the commit addresses rather than the
action it takes, because the diff already shows the action. `git log` is
relied on as evidence of the human direction behind each change, per
PROVENANCE.md § 2, so the body should say what was wrong and why this is the
fix.
