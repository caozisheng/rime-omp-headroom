# rime-omp-headroom

<img width="505" height="103" alt="image" src="https://github.com/user-attachments/assets/ffd46780-190e-48e0-a4a7-87878096c4ff" />

`rime-omp-headroom` is an independent fork of the original `omp-headroom` extension for [Oh My Pi (OMP)](https://github.com/can1357/oh-my-pi). The changes in this repository are maintained here and have not been submitted upstream.

This fork combines two systems in one OMP extension:

- local Headroom context compression, retrievable CCR session archives, proxy lifecycle management, and live statistics;
- an animated ASCII pet that reacts to the current OMP session state and shares the Headroom widget.

This repository is installed directly from source. It is not distributed through a managed plugin channel.

## Features

### Headroom context optimization

- Routes eligible provider payloads through the local [Headroom](https://github.com/chopratejas/headroom) proxy.
- Accepts a compressed result only when proxy metrics confirm a strict reduction and the outgoing payload is smaller.
- Preserves user messages and a configurable live conversation tail.
- Stores replaced transcript prefixes in local content-addressed CCR archives.
- Registers `headroom_retrieve` so an archived original can be recovered by hash.
- Supports the Anthropic Messages and OpenAI Responses/Chat payload shapes used by OMP.
- Tracks provider, tool-result, archive, cache, request, token, and cost statistics per session.
- Provisions and maintains the Python `headroom-ai` environment, with optional ROCm or CUDA acceleration.

### Integrated ASCII pet

- Renders the selected pet beside the Headroom statistics box in one widget.
- Includes `cat`, `dog`, and `parrot` packs.
- Reacts to thinking, tool execution, approval waits, success, failure, compaction, and interruption.
- Discovers additional packs from user and project directories.
- Ignores malformed external packs with a warning instead of failing the extension.
- Uses the same `/headroom on|off` session switch as compression and the statistics widget.

## Requirements

- OMP 16.4 or newer.
- [Git](https://git-scm.com/) to clone and update this repository.
- [Bun](https://bun.sh/) to install the extension dependencies.
- Python to create the managed Headroom environment.
- Optional: a compatible AMD ROCm or NVIDIA CUDA environment. CPU operation is supported.

## Install from source

Choose a permanent checkout location. OMP links to this directory in place, so moving or deleting it later breaks the plugin link.

```bash
git clone https://github.com/caozisheng/rime-omp-headroom.git
cd rime-omp-headroom
bun install
omp plugin link .
omp plugin doctor
```

Start a new OMP session after linking the checkout. On first use, the extension creates its Python environment and installs `headroom-ai`; this can take longer than later starts.

If OMP already loads a standalone pet extension, remove or disable that extension first. This fork owns the pet commands, lifecycle hooks, timers, and merged widget itself.

### Update this fork

Update the TypeScript extension and bundled pet assets from the Git checkout:

```bash
cd /path/to/rime-omp-headroom
git pull --ff-only
bun install
omp plugin doctor
```

Then run `/reload-plugins` in OMP or start a new session.

`/headroom update` is different: it updates the managed Python `headroom-ai` backend while preserving the selected backend. It does **not** pull this Git repository or update the TypeScript extension.

### Remove the source link

The linked checkout is registered under the package name `omp-headroom` (from `package.json`), not the repository name. Remove it with:

```bash
omp plugin uninstall omp-headroom
```

Delete the checkout directory only after OMP no longer references it.

## Usage

Commands are entered inside an OMP session. Type `/headroom ` or `/pet ` to use argument completion.

### Headroom commands

| Command | Description |
| --- | --- |
| `/headroom stats` | Show proxy, compression, cache, archive, CCR, and cost statistics. |
| `/headroom on` | Enable compression, the Headroom widget, and pet animation for this session. |
| `/headroom off` | Disable compression and suspend the pet for this session. |
| `/headroom compact` | Run OMP semantic compaction with a retrievable Headroom CCR archive. |
| `/headroom clear session confirm` | Delete CCR archives and archive counters owned by the current session. |
| `/headroom test tool` | Exercise the real proxy compression path. |
| `/headroom test compaction` | Open an isolated native OMP compaction fixture. |
| `/headroom start` | Start or connect to the Headroom proxy. |
| `/headroom stop` | Stop the managed proxy. |
| `/headroom restart` | Restart the managed proxy. |
| `/headroom reconnect` | Retry the proxy connection after automatic retries are exhausted. |
| `/headroom service ...` | Install, remove, inspect, or render the user-service definition. |
| `/headroom config` | Show effective settings and their sources. |
| `/headroom set <key> <value>` | Persist a supported setting to `~/.omp/agent/headroom.yml`. |
| `/headroom version` | Show extension, proxy, binary, configuration, and log information. |
| `/headroom debug` | Show sizing-log and proxy diagnostics. |
| `/headroom update` | Update only the managed Python `headroom-ai` backend. |
| `/headroom help` | List the complete command surface. |

### Pet commands

```text
/pet
/pet status
/pet cat
/pet dog
/pet parrot
```

`/pet` and `/pet status` report the selected pack, lifecycle, current action, and discovered pack IDs. `/pet <pack-id>` changes the pack for the current session. Use `/headroom on` or `/headroom off` to enable or suspend the integrated pet.

## Configuration

The extension reads flat YAML settings from:

```text
~/.omp/agent/headroom.yml
```

Every YAML setting also has an `OMP_HEADROOM_*` environment variable. Environment variables override YAML; YAML overrides the built-in default.

Inspect the exact supported keys, effective values, and sources with:

```text
/headroom config
```

Persist a supported key with:

```text
/headroom set <key> <value>
```

The change takes effect after `/reload-plugins` or in a new session. If the corresponding environment variable is set, it continues to override the saved YAML value.

Common settings control:

- the Headroom binary path;
- provider and tool-output compression thresholds;
- adaptive threshold scaling;
- sizing diagnostics;
- session archive enablement and retained live-message count;
- archive size thresholds and storage paths.

Pet visibility is intentionally tied to the Headroom session switch; there is no separate visibility or alignment setting.

### Custom pet packs

Place JSON packs in either directory:

```text
~/.omp/agent/pets/
<project>/.omp/pets/
```

Project packs take precedence over user packs, which take precedence over bundled packs with the same ID. Packs must use the validated, fixed-size printable-ASCII format used in `packs/`. Malformed files are skipped with a warning. New packs are discovered when OMP starts the extension.

Select a discovered pack with:

```text
/pet <pack-id>
```

## Widget behavior

The Headroom box and pet are rendered by one component. Animation frames request repaint without replacing the statistics widget, and the layout adapts to the width supplied by OMP. The bundled cat uses a 70-column motion stage so its large horizontal actions need 70 columns beside the Headroom box to remain fully visible. Narrower panels clip artwork at the panel boundary, but lifecycle updates and the Headroom rainbow continue to run.

## Local data and privacy

- The Python environment, CCR archives, archive counters, and logs live under the local OMP data directory.
- CCR originals are stored under a validated OMP session ID and addressed by content hash.
- The extension does not send archived originals back to a provider unless the agent explicitly retrieves and uses them.
- Diagnostics and widget statistics contain sizes, counts, percentages, costs, and status data; they do not intentionally log message contents.
- `/headroom clear session confirm` removes only the current session's owned CCR archives and archive counters.

## Development

Install dependencies and run the repository checks:

```bash
bun install
bun run check
bun run typecheck
bun run test
bun run scan
```

Run all checks with:

```bash
bun run verify
```

The checkout itself is the development installation. After changing extension code, run `/reload-plugins` in OMP or start a new session.

## Project layout

```text
src/index.ts          OMP lifecycle hooks, commands, and proxy integration
src/widget.ts         Headroom statistics and merged pet widget
src/pet-runtime.ts    Pack discovery and per-session pet runtime adapter
src/pet/              Pack validation, state resolution, animation, and rendering
packs/                Bundled cat, dog, and parrot assets
tests/                Compression, archive, widget, and pet regression tests
systemd/              Optional user-service template
provenance.json       Pet artwork sources and transformation record
licenses/             Third-party asset licenses

## Credits and license

- The original `omp-headroom` project provided the base for this independent fork.
- [Headroom](https://github.com/chopratejas/headroom) provides the compression proxy and is licensed under Apache-2.0.
- [Oh My Pi](https://github.com/can1357/oh-my-pi) provides the host coding-agent runtime.
- Bundled cat and dog artwork is derived from [Campy / OpenCode Pets](https://github.com/dropdevrahul/campy). See [`provenance.json`](provenance.json) and [`licenses/CAMPY-MIT.txt`](licenses/CAMPY-MIT.txt).
- AMD acceleration uses [ROCm](https://rocm.docs.amd.com/) and compatible PyTorch wheels when available.

The extension code is licensed under [GPL-3.0-or-later](LICENSE). Third-party notices are collected in [`.github/THIRD_PARTY_NOTICES.md`](.github/THIRD_PARTY_NOTICES.md).
