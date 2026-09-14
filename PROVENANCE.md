# Provenance and authorship

This file records where this software came from, who made it, and what is in it
that someone else made. It exists because those questions get asked by anyone
assessing a work formally — a registrar, an examiner, a reviewer, an employer —
and answering them from memory a year later is how inaccuracies enter a record
that is supposed to be reliable.

Nothing here is legal advice. It is a factual record, assembled so that whoever
gives you legal advice has accurate facts to work from.

---

## 1. The work

| | |
|---|---|
| **Name** | TesserCAD |
| **What it is** | A parametric CAD application: 3D solid modelling, 2D drafting, and a timeline for sequencing and simple dynamics. Runs as a static web page and as a desktop application. |
| **Licence** | MIT (see [LICENSE](LICENSE)) |
| **Repository** | https://github.com/samuelhtampubolon/TesserCAD |
| **First commit** | 2026-05-16 |
| **This record** | 2026-09-13 |
| **Commits** | `git rev-list --count HEAD` — counted rather than quoted, because the commit that corrects a quoted figure changes it |
| **Released** | `v1.0.4`, with Windows and Linux builds. Earlier tags are superseded: `v1.0.2` and before bundled an end-of-life Electron, and `v1.0.3` built nothing because its packaging configuration was rejected |

### Size

| | |
|---|---|
| Application source | 23,147 lines across 51 modules (`src/`) |
| Test and build tooling | 8,770 lines across 38 files (`tools/`, `desktop/`) |
| Third-party code included | three.js r169, vendored unmodified (`vendor/`) |
| Runtime dependencies fetched at install | none |

---

## 2. Authorship, stated plainly

**Samuel Tampubolon** directed the work, set its requirements, made its design
decisions, and owns the repository.

**The code was written with substantial assistance from an AI system**
(Anthropic's Claude, via Claude Code). This is not incidental and it is not
hidden. **This section is the disclosure, and it is the authoritative one.**
It covers the whole of this repository's source, not a marked subset of it,
and it is stated here first rather than left to be discovered later.

The git history corroborates that only in part, and the limit matters.
Commits up to and including `90bce2a` carry `Co-Authored-By: Claude
<noreply@anthropic.com>` trailers, so `git log` names Claude as an author
alongside the repository owner across that range. Commits after it do not
carry the trailer, following the convention recorded in
[CLAUDE.md](CLAUDE.md).

**A missing trailer therefore says nothing about how a commit was written.**
It reflects a change in this repository's commit formatting, not a change in
how the work is produced. Anyone sizing the AI contribution by counting
trailers will undercount it, and should rely on the statement above
instead.

### Why this is flagged rather than glossed

How copyright treats AI-assisted work is **unsettled and differs by
jurisdiction**. Some offices require human authorship for protection and treat
purely machine-generated portions as unprotectable; some require disclosure of
AI involvement when registering; some have not ruled. Which of those applies to
you depends on where you file, and this document cannot tell you.

What it can do is make sure you are not surprised:

- **Disclose the AI assistance** to whoever handles your filing, before filing.
  The git history is evidence; a record that contradicts it is worse than no
  record.
- **Be ready to describe the human contribution specifically** — the
  requirements, the design decisions, the review and acceptance of each change,
  the direction given at each step. That contribution is real and is documented
  across this repository's commit messages, which are unusually detailed for
  exactly this kind of reason.
- **Ask your advisor what your jurisdiction requires.** Do not rely on this
  file, and do not rely on any AI system, for that answer.

---

## 3. Third-party material, and its terms

Two pieces of this software originate outside it. Both are permissively
licensed and both are credited in full in [ATTRIBUTION.md](ATTRIBUTION.md).

| What | Origin | Licence | How it is used |
|---|---|---|---|
| **three.js r169** | mrdoob and contributors | MIT | Vendored unmodified in `vendor/`, with the upstream licence at `vendor/THREE-LICENSE.txt`. Not forked, not patched |
| **The BSP boolean algorithm** | Evan Wallace's csg.js (2011) | MIT | `src/core/csg-core.js` follows its decomposition. Rewritten over typed arrays, but the shape of the algorithm is not ours and the header says so |

MIT permits both uses and requires the notice be preserved; it is, in the file
and in ATTRIBUTION.md.

Published mathematical methods are used throughout — Green's theorem, Kåsa's
circle fit, Box–Muller, Abramowitz & Stegun's normal CDF approximation, ISO
standard tables. A formula is not copyrightable, but each is attributed in
ATTRIBUTION.md § 2 anyway, because the point is that the numbers can be
checked.

### What is *not* in this repository

Thirteen open-source CAD and 3D projects informed the requirements — FreeCAD,
Blender, BRL-CAD, LibreCAD, OpenSCAD, QCAD, SolveSpace, CadQuery, build123d,
chili3d, MeshLab, Bforartists, dust3d. **No code, data, asset or interface
resource from any of them is present here.**

Ten of the thirteen are GPL, LGPL or AGPL, so copying from them into an
MIT-licensed work would be a licence violation rather than a matter of taste.
That separation is enforced rather than asserted:
`tools/tests/architecture.mjs` fails the build if any file in `src/` mentions
one of them beyond the five documented lines, which are three explanatory
comments and two search keywords.

```bash
node tools/tests/architecture.mjs     # includes the originality check
```

---

## 4. What is claimed as original

Stated narrowly, so each claim can be examined rather than taken on trust.
[COMPARISON.md](COMPARISON.md) § 1 gives the longer argument, including what
this software does *not* do.

- **History as a tree.** An edit made after an undo branches the history rather
  than truncating it, so no state reached during a session becomes unreachable.
  Implemented in `src/core/doc.js`.
- **A boolean worker pool driven by the document's own dependency depth**, with
  no scheduler: features at equal depth are independent by construction, so a
  whole depth dispatches at once. `src/core/csg-pool.js`.
- **The document and its text as a single object**, either one editable, with
  the round-trip verified against the user's own document rather than a fixture.
  `src/intel/spec.js`.
- **A three-way merge over a parametric feature tree**, including the rule that
  disjoint insertions compose while a reordering is the question a merge cannot
  answer. `src/intel/merge.js`.
- **Engineering analysis inside the modeller** rather than beside it: cost and
  process crossover, tolerance stack-up with Cp/Cpk and ISO 286 fits, section
  properties with load cases, ISO fastener data, orthographic drawings with
  hidden-line removal.

---

## 5. Integrity of the record

The claims above are not assertions in prose. They are properties this
repository checks and fails the build over.

| | |
|---|---|
| Headless checks | 898 across 16 suites, about four seconds, downloads nothing |
| Browser checks | 394 across 11 browser suites, in a real Chromium |
| Desktop checks | 17, driving the real application in a real Electron window |
| Security checks | 76, which run attacks rather than assert outcomes |

```bash
npm test               # the headless suites, plus the documentation check
npm run test:browser   # the browser suites
npm run verify:desktop # the desktop shell
```

Every released binary additionally carries a **signed build-provenance
attestation** recording the commit, workflow and runner that produced it, in a
public transparency log the publisher does not control:

```bash
gh attestation verify TesserCAD-1.0.4-windows-x64.zip \
  --repo samuelhtampubolon/TesserCAD
```

> **Artefacts published before the repository was renamed** record the old name
> inside their attestation, because the name is baked in at build time. The
> v1.0.4 attestation names
> `https://github.com/samuelhtampubolon/Portofolio_Tutorial@refs/tags/v1.0.4`,
> so for those files pass `--repo samuelhtampubolon/Portofolio_Tutorial`
> instead. The underlying repository id is unchanged (`1240582571`), and the
> next release carries the new name, after which only the command above is
> needed.

That is stronger evidence of origin than a code-signing certificate, which
attests to an identity rather than to a source. For a filing, it means the
binary can be tied to a specific commit without relying on anyone's word.

---

## 6. Known limitations

Recorded here because a record that only lists strengths is not a record.
[README](README.md) § Honest limitations has the full list; the ones that most
affect how this work should be characterised:

- **It is a mesh modeller, not a B-rep kernel.** No NURBS, no fillets on
  arbitrary edges, no STEP or IGES exchange.
- **No geometric constraint solver.**
- **No FEA, CFD or stress analysis.** Collision uses bounding spheres.
- **The desktop builds are not code-signed**, so Windows SmartScreen shows an
  unknown-publisher prompt. [SECURITY.md](SECURITY.md) explains what that does
  and does not mean.
- **Cost figures are order-of-magnitude**, drawn from published shop guidance,
  and are labelled as such in the interface itself.
