# End-to-end test: every command in a real VS Code

`runner.js` runs every command the extension contributes (74) inside a real, isolated VS Code. `hook.js` answers each pick list, input box and message automatically:

- Pick lists get the first item, or the item a rule in `PICK_RULES` prefers (Icarus, `smoke`, adder…).
- Input boxes get their default value.
- Confirmations are declined, so nothing is ever overwritten.

The runner records what each command asked and showed. A command passes when it finishes without throwing an error, hanging, or showing an error message.

## Workspace

Make a folder with:

- `adder/`, a project made by `dvflow init --file adder/design/adder.sv --root adder`, with one regression run using `--waves 1` (so a VCD exists);
- `fsm/traffic_light.sv`, from `examples/`;
- `fsm/handshake.wavedrom`.

## Run (Windows, PowerShell)

```powershell
$env:TENX_E2E_HOOK = "$PWD\test\e2e\hook.js"
& "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe" `
  --extensionDevelopmentPath="$PWD" --extensionTestsPath="$PWD\test\e2e\runner.js" `
  --user-data-dir="$env:TEMP\tenx-e2e-ud" --extensions-dir="$env:TEMP\tenx-e2e-ext" `
  --disable-workspace-trust --skip-welcome --new-window C:\path\to\workspace
```

Results go to `test/e2e/results.json`, or to the path in `TENX_E2E_OUT`. The `TENX_E2E_HOOK` variable is read only at activation, and only by this test. Users never set it.

## Webview checks (headless Edge)

| Script | Checks |
|---|---|
| `dashboard-tabs.js <report index.html>...` | Every dashboard tab, the run drawer and the themes; prints JavaScript errors |
| `wave-viewer.js <page>` and `wave-decoders.js <page>` | The waveform viewer's buttons, keys, cursor, context menu, tool tabs and all 11 decoders |

The page for the viewer checks is a standalone copy of the waveform viewer, built from a VCD.

## Last result (0.17.3)

- 71 of 74 commands passed. 3 were skipped on purpose: *Create Demo Project* switches folders, *Stop Containers* would stop the toolchain mid-test, and *Open Terminal in Container* only opens a shell.
- 90 prompts were answered, and there were no unhandled errors.
- All 5 views opened.
- The dashboard tabs and the waveform viewer showed 0 JavaScript errors.
