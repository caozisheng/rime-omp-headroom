# omp-headroom

`omp-headroom` is an [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi) extension that combines local Headroom context compression with a live statistics widget and an animated ASCII pet.

This repository is a maintained fork of the upstream `omp-headroom` extension. It includes the Headroom integration, CCR session archives, proxy lifecycle management, and the merged pet runtime in one installable OMP plugin.

## Features

### Context optimization

- Routes eligible provider payloads through the local [Headroom](https://github.com/chopratejas/headroom) proxy.
- Compresses tool-heavy context only when the result is strictly smaller and proxy metrics confirm the reduction.
- Preserves user messages and the live conversation tail.
- Stores complete replaced prefixes in local CCR archives and exposes retrieval through the registered `headroom_retrieve` tool.
- Supports Anthropic Messages and OpenAI Responses/Chat-style payloads used by OMP.
- Tracks provider, tool-result, archive, cache, request, token, and cost statistics per OMP session.
- Includes adaptive thresholds, retryable proxy startup, version reconciliation, service management, and GPU-aware Headroom installation.

### Integrated ASCII pets

- One merged widget renders the Headroom statistics box and the selected pet side by side.
- Bundled packs: `cat`, `dog`, and `parrot`.
- Lifecycle and reaction animations cover thinking, tool execution, waiting for approval, success, failure, compaction, and interruption.
- Packs are discovered from the package, the user pack directory, and the current project.
- Invalid external packs are ignored with a warning instead of breaking the extension.
- Pet visibility and animation are controlled by the unified `/headroom on|off` switch.
- The widget keeps the selected pet adjacent to the Headroom box and adapts to the available terminal width.

## Requirements

- OMP 16.4 or newer; OMP 17 and 18 are supported by the current package.
- Bun for development and local linking.
- Python for the Headroom proxy environment. The extension provisions its own environment; a system Python installation is still required.
- Optional AMD ROCm or NVIDIA CUDA support when a compatible PyTorch build is available. CPU operation remains supported.

## Installation

### Marketplace or package installation

Install the published plugin through OMP's plugin manager:

```text
omp plugin install omp-headroom
```

Verify the installation:

```text
omp plugin doctor
```

The plugin manifest loads `src/index.ts` and packages the bundled pet assets under `packs/`.

### Development checkout

```bash
git clone https://github.com/caozisheng/rime-omp-headroom.git
cd rime-omp-headroom
bun install
omp plugin link .
omp plugin doctor
```

`omp plugin link .` points OMP at the checkout. It does not copy the extension into the user extension directory.

If another plugin supplies the old standalone pet runtime, remove that extension from `~/.omp/config.json`; this repository now provides the pet runtime itself.

## Commands

Commands are entered in an OMP session. Type `/headroom ` or `/pet ` to use OMP argument completion.

### Headroom

| Command | Description |
| --- | --- |
| `/headroom stats` | Show proxy, compression, cache, archive, CCR, and cost statistics. |
| `/headroom on` | Enable compression, the Headroom widget, pet visibility, and pet animation. |
| `/headroom off` | Disable compression and stop pet animation while retaining the status box. |
| `/headroom compact` | Run the OMP semantic compaction path with a Headroom CCR archive. |
| `/headroom clear session confirm` | Remove the current session's owned CCR archives and archive counters. |
| `/headroom test tool` | Run the real proxy compression surface. |
| `/headroom test compaction` | Open the native OMP compaction fixture. |
| `/headroom start` | Start or connect to the Headroom proxy. |
| `/headroom stop` | Stop a proxy process owned by this extension. |
| `/headroom restart` | Restart an extension-owned proxy. |
| `/headroom reconnect` | Retry proxy connection after bounded startup attempts are exhausted. |
| `/headroom service ...` | Install, remove, inspect, or render the proxy service definition. |
| `/headroom config` | Show effective Headroom settings. |
| `/headroom set <key> <value>` | Change a supported setting for the current configuration. |
| `/headroom version` | Show the installed extension and proxy versions. |
| `/headroom update` | Update Headroom while preserving the selected backend. |

### Pets

```text
/pet
/pet status
/pet cat
/pet dog
/pet parrot
```

`/pet` and `/pet status` report the selected pack, lifecycle, current action, and discovered pack IDs. Pack selection is independent of the unified visibility switch; use `/headroom on` or `/headroom off` to show or hide the pet.

## Configuration

Headroom settings can be configured through the OMP configuration system and environment variables. Environment variables take precedence over the user configuration file.

Common settings include:

- proxy URL and port;
- compression enablement;
- minimum eligible tool-output size;
- protected recent-message count;
- session archive enablement and live-tail size;
- model, provider, and service installation options.

Inspect the effective values with:

```text
/headroom config
```

The extension does not add a separate pet alignment or pet visibility setting. Pet behavior is intentionally tied to the Headroom session switch.

### Custom pet packs

Place JSON packs in either location:

```text
~/.omp/agent/pets/
<project>/.omp/pets/
```

A pack must use the validated fixed-size ASCII format used by the bundled assets. The project directory has higher precedence than the user directory; malformed files are skipped with a warning. After starting a session, select a discovered pack with:

```text
/pet <pack-id>
```

## Widget behavior

The widget is a component factory rather than a static string list, so animation frames can request repaint without remounting the Headroom box. The Headroom box remains the left-hand side; the selected pet is placed immediately after its right border.

When the host supplies a narrow widget width, the component constrains the pet side to the available width instead of replacing the merged component with a plain Headroom widget. The host may clip the artwork at the panel boundary, but lifecycle changes and the Headroom rainbow remain active.

## Local data and privacy

- CCR originals are written to the local OMP data directory under a validated session ID.
- Archive files are addressed by content hash and are never sent to the provider by the extension itself.
- Compression diagnostics and widget statistics contain counts, sizes, percentages, and costs; they do not intentionally log message contents.
- `/headroom clear session confirm` removes only archives and archive counters owned by the current valid session.

## Development

```bash
bun install
bun run check
bun run typecheck
bun run test
bun run scan
```

The complete verification command is:

```bash
bun run verify
```

Create a package preview with:

```bash
npm pack --dry-run --json
```

The published package must include `packs/`, `licenses/`, and `provenance.json` in addition to the extension source and service template.

## Project layout

```text
src/index.ts          OMP extension lifecycle, commands, hooks, and proxy integration
src/widget.ts         Headroom statistics widget and merged pet component
src/pet-runtime.ts    Pack discovery and per-session pet runtime adapter
src/pet/               Pack validation, state resolution, animation, and rendering
packs/                 Bundled cat, dog, and parrot JSON assets
tests/                 Compression, archive, widget, and pet regression tests
docs/                  Integration design notes
provenance.json        Artwork source and transformation record
licenses/              Third-party asset licenses
```

## Credits and license

- [Headroom](https://github.com/chopratejas/headroom) provides the compression proxy and is licensed under Apache-2.0.
- [Oh My Pi](https://github.com/can1357/oh-my-pi) provides the host coding-agent runtime.
- Bundled cat and dog artwork is derived from [Campy / OpenCode Pets](https://github.com/dropdevrahul/campy). See [`provenance.json`](provenance.json) and [`licenses/CAMPY-MIT.txt`](licenses/CAMPY-MIT.txt).
- AMD acceleration uses [ROCm](https://rocm.docs.amd.com/) and compatible PyTorch wheels when available.

The extension code is licensed under [GPL-3.0-or-later](LICENSE). Third-party notices are collected in [`.github/THIRD_PARTY_NOTICES.md`](.github/THIRD_PARTY_NOTICES.md).
