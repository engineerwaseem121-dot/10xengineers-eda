# Maintainers

Release steps for the extension and its Docker tools image.

## Publishing the tools image (maintainers)

Users download the image from GitHub Container Registry. Publishing is a separate, manual release step:

1. Change the tools in [container/Dockerfile](../container/Dockerfile) and bump `version` in [container/image.json](../container/image.json). Keep the major version for compatible changes; the extension only switches to tags with the same major version.
2. CI (`.github/workflows/ci.yml`, job **image**) builds the image and runs `tenx-smoke` whenever `container/` changes. Nothing is pushed.
3. Publish: GitHub → **Actions → Publish Docker image → Run workflow**, or push a tag `image-v<version>` (for example `image-v1.0.0`). The workflow builds, smoke-tests and pushes `ghcr.io/<owner>/eda-tools:<version>`. It refuses to overwrite a published version.
4. First publish only: GitHub → your profile → **Packages → eda-tools → Package settings → Change visibility → Public**, so users can download it without logging in.
5. Release the extension: the version in `container/image.json` is the image new installs download.

From your own machine instead of Actions:

```bash
docker build -t ghcr.io/engineerwaseem121-dot/eda-tools:1.0.0 container
docker run --rm ghcr.io/engineerwaseem121-dot/eda-tools:1.0.0 tenx-smoke
echo <a GitHub token with write:packages> | docker login ghcr.io -u engineerwaseem121-dot --password-stdin
docker push ghcr.io/engineerwaseem121-dot/eda-tools:1.0.0
```

---


## Releasing the extension

1. Run the unit tests: `node test/unit.js`. All must pass.
2. Run the library sweep:
   - On Windows with Docker in WSL, set `DVFLOW_TOOLCHAIN=container`.
   - Run `node test/library-sweep.js --out <folder>`.
   - Every runnable design must pass. Copy the report to `examples/library/SWEEP-REPORT.md`.
3. Run the end-to-end test of every command in a real VS Code. See [test/e2e/README.md](../test/e2e/README.md).
4. Bump `version` in `package.json` and add the changes to `CHANGELOG.md`.
5. Build the package: `npx @vscode/vsce package --no-dependencies -o dist/10xengineer-eda-<version>.vsix`.
6. Upload the `.vsix` at https://marketplace.visualstudio.com/manage. For Cursor and VSCodium, also upload it to Open VSX.
7. Commit, then push to `main`.

## Adding a design to the library

Follow [examples/library/README.md](../examples/library/README.md):

- The folder must hold the RTL, `SPEC.md`, `meta.json` (with `expected_template`), and a `<name>_check.sv` that prints `CHECK PASS`.
- For combinational designs that have no built-in template, add the expected values from the spec to `meta.json` → `behavior.checks`, so **New Design from Library** creates a project that runs straight away.
