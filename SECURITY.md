# Security policy

Report vulnerabilities privately through the repository's security advisories ("Report a vulnerability"), not in public issues.

## Threat model

`analyze_repository` reads code chosen by a model, which may follow instructions planted in files it reads (prompt
injection). Mitigations:

- reads are confined to `DRAWMAN_WORKSPACE_ROOTS` (realpath-checked); remote clones are https/ssh only, shallow,
  without symlinks, into the OS temp folder; `DRAWMAN_ALLOW_CLONE=0` turns them off;
- credential files are never opened, and secret-looking values are masked in evidence and model context;
- the server executes no repository code, and git runs with `GIT_TERMINAL_PROMPT=0` and validated arguments;
- writes happen only to `DRAWMAN_OUTPUT_DIR` under the first workspace root, as `.drawio` files with sanitised names;
- the MCP App view has no network access (empty CSP allow-lists) and escapes all model-provided text.

The HTTP transport has no authentication; bind it to localhost or put it behind a gateway that authenticates.
