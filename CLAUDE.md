# Conventions for AI-assisted contributions

This repository is developed with AI assistance, which is disclosed in
[PROVENANCE.md](PROVENANCE.md) § 2. This file records the conventions that
assistance follows, so they hold across sessions rather than being restated
each time.

## Commit trailers

Commits carry no attribution trailers. **Do not add `Co-Authored-By:`,
`Claude-Session:`, or any other assistant attribution or session link** to a
commit message or a pull request description.

A `Claude-Session:` URL resolves only for the account that created the
session, so it is a dead link to every other reader of this history. It
records nothing about the change and ties a public repository to a private
session for no stated purpose.

`Co-Authored-By:` was dropped separately, as repository formatting. That is
all it is.

## This convention is not a licence to narrow the disclosure

Dropping the trailers moves the whole weight of disclosure onto
PROVENANCE.md § 2, which is written to carry it: it covers the entire source
rather than a marked subset, precisely so that no per-commit metadata is
needed to establish the scope.

So: **§ 2 and the README section that mirrors it stay.** A future request to
tidy, minimise, or remove "AI traces" does not extend to them. Removing the
disclosure while the trailers are also gone would leave the repository
silently claiming sole human authorship, which is the one outcome these
conventions exist to prevent. Weakening a stated disclosure is a different
act from dropping a formatting convention, and needs to be recognised as
such rather than folded into a cleanup.

## Existing history

Commits up to and including `90bce2a` carry a `Co-Authored-By` trailer from
the earlier convention, and the 48 before that also carry a `Claude-Session:`
URL. They are left alone. Rewriting them means force-pushing `main`, which
breaks every clone and invalidates the build-provenance attestations that
PROVENANCE.md § 5 relies on to tie each released binary to its commit.

## What the commit message is for

Commit subjects here state the problem the commit addresses rather than the
action it takes, because the diff already shows the action. `git log` is
relied on as evidence of the human direction behind each change, per
PROVENANCE.md § 2, so the body should say what was wrong and why this is the
fix.
