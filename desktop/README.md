# The Crown desktop wrapper

This Tauri 2 shell embeds `../outputs` directly. It adds no network request and
uses three Rust commands to store the existing serialized save strings beneath
the operating system's application-data directory. The web build still uses
`localStorage`; no save schema or simulation formula changes between targets.

## Build

Install the platform prerequisites, Rust, and Tauri CLI 2, then run from this
directory:

```sh
cargo tauri build --bundles app
```

On Windows, use:

```powershell
cargo tauri build --bundles nsis
```

The macOS `.app` and Windows NSIS installer are written below
`src-tauri/target/release/bundle/`. Upload the same bundle to itch.io; no
itch-specific fork is required. Press F11 to enter or leave fullscreen.

The paid desktop runtime hides the playtest share button and result code. All
play stats remain local in the save file. The browser demo keeps its existing
`crown1` result-code flow.

## Local verification status

The JavaScript adapter and wrapper layout are covered by `work/test_f4_final.mjs`.
This checkout's host did not have `cargo`, `rustc`, or `cargo-tauri`, so native
bundle production must run in the checked-in GitHub Actions matrix or on a host
with those prerequisites. Do not mark the Steam ship gate complete until both
artifacts have been downloaded and launched once.

