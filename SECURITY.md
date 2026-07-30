# Security Policy

## Supported versions

`ffm-script` follows [SemVer](https://semver.org/), and only the latest published
release receives fixes. If you're on an older version, upgrade before reporting —
the issue may already be fixed.

| Version | Supported |
| ------- | --------- |
| 1.x     | ✅        |
| < 1.0   | ❌        |

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through GitHub's
[private vulnerability reporting](https://github.com/Doud75/ffm-script/security/advisories/new)
form. The report stays visible only to you and the maintainer until a fix ships.

Useful things to include:

- the affected version of `ffm-script`, plus your Node.js and FFmpeg versions,
- a minimal reproduction (the API call and the options you passed),
- what an attacker gains, and what they need to control to get there.

Expect an acknowledgement within a few days. This is a small, single-maintainer
project, so please allow a reasonable window for a fix before disclosing publicly.
Credit is given in the advisory and the `CHANGELOG.md` entry unless you'd rather
stay anonymous.

## Scope

`ffm-script` is a dependency-free wrapper around the `ffmpeg` and `ffprobe`
binaries. That shapes what counts as a vulnerability here.

**In scope**

- Argument injection into the FFmpeg command line — a caller-supplied value (a
  file path, an option) escaping into a position where FFmpeg reads it as a flag.
- Path traversal or unintended writes through the output paths the library builds
  itself (HLS variant folders, `parallelConvert` chunk files, temporary files).
- Anything that turns a normal API call into arbitrary command execution.
- Resource exhaustion caused by the library's own logic rather than by the media
  you handed it (an unbounded worker pool, a leaked child process).

**Out of scope**

- Vulnerabilities in FFmpeg itself, or in the codecs it links against. Report
  those upstream to the [FFmpeg project](https://ffmpeg.org/security.html) and
  keep your FFmpeg build up to date — `ffm-script` executes whichever binary is
  on your `PATH` (or the one `FFMPEG_PATH` / `FFPROBE_PATH` points at).
- `run()`, `runStream()` and the chainable `.raw()`. These are documented escape
  hatches: they forward your argument list to FFmpeg verbatim, so **you** own the
  validation of anything you interpolate into it. Note that arguments are passed
  through `spawn` without a shell, so there is no shell injection — but a path
  starting with `-` can still be read as a flag. Hardening helpers for this are on
  the roadmap.
- Passing an untrusted `FFMPEG_PATH` / `FFPROBE_PATH`, or an attacker-controlled
  `PATH`. Whoever controls those already controls the process.
- Crashes or malformed output caused by a malicious input file — that's FFmpeg's
  parsing, not ours.
