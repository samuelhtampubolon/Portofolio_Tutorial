# Downloads

**The builds are not in this folder, and cannot be.** If you came here looking
for them, they are on the
[**Releases page**](https://github.com/samuelhtampubolon/Portofolio_Tutorial/releases).

## Why not here

TesserCAD's desktop build is an Electron application, which means it ships a
complete Chromium runtime alongside the app:

| | Size |
|---|---|
| The application itself | **2 MB** (`resources/app.asar` — 83 files) |
| The Chromium + Node runtime around it | **269 MB** unpacked |
| The Windows download, zipped | **~115 MB** |

GitHub refuses any file over **100 MB** in a repository, and warns above 50 MB.
So a committed build would not merely be untidy, it would be rejected by the
push — and if it squeaked under, every `git clone` of this repository would
drag the whole runtime down with it, forever, once per release, because git
history is permanent.

Releases exist precisely for this. They allow files up to 2 GB, they do not
enter the repository's history, and they appear in the sidebar on the
repository's front page, which makes them easier to find than a folder.

## Where to get a build

| | |
|---|---|
| **Releases** | [github.com/samuelhtampubolon/Portofolio_Tutorial/releases](https://github.com/samuelhtampubolon/Portofolio_Tutorial/releases) |
| **No download at all** | The hosted version is the same application and installs nothing |

On Windows, take the **`.zip`** rather than the installer. It extracts nothing
and writes nothing to `%TEMP%`; you unzip it and run `TesserCAD.exe` from
wherever you put it. See [SECURITY.md](../SECURITY.md) for why that matters and
for what to do about the SmartScreen prompt.

## Building one yourself

Everything needed is in the repository; nothing is hidden in a release pipeline.

```bash
cd desktop
npm ci
npm run dist          # writes to ../dist-desktop/
```

A Windows build must be produced on Windows, or on Linux with Wine installed:
the step that writes the executable's version metadata (product name, company,
copyright) runs a Windows tool. That metadata is not cosmetic — an executable
without it is more likely to be flagged by endpoint protection — so it is not
skipped to make cross-building convenient.

`.github/workflows/desktop.yml` is what CI runs, on a Windows runner and a
Linux one, and it is worth reading before trusting any binary from here: it
runs the full test suite, launches the shell and drives the real application in
it, publishes a SHA-256 beside every artefact, and attaches a signed
build-provenance attestation naming the commit that produced each file.
