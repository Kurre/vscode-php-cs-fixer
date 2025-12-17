## Purpose

This file is for AI agents working on the `vscode-php-cs-fixer` project. It documents:
- Project intent and architecture at a high level
- Responsibilities boundaries between this extension and the `php-cs-fixer` CLI
- Operational constraints (tooling, tests, CI assumptions)
- Modification guidelines (what to change, what to avoid)

Keep changes minimal, safe, and well-covered by tests.

## Project Overview

- VS Code extension that formats PHP and mixed PHP/HTML using the `php-cs-fixer` CLI.
- Main runtime entry: `dist/index.js` built from `[src/index.ts](src/index.ts)` which re-exports `activate`/`deactivate` from `[src/extension.ts](src/extension.ts)`.
- Primary logic lives in `[src/extension.ts](src/extension.ts)` (class `PHPCSFixer` and `activate` wiring).
- Support modules:
  - `[src/runAsync.ts](src/runAsync.ts)`: spawns child process, collects stdout/stderr, wraps non-zero exit in `ProcessError`.
  - `[src/output.ts](src/output.ts)`: VS Code output channel + status bar wrapper.
  - `[src/beautifyHtml.ts](src/beautifyHtml.ts)`: HTML + PHP/templating aware beautification when `formatHtml` is enabled.
  - `[src/download-phar.ts](src/download-phar.ts)`: downloads `php-cs-fixer.phar` from upstream URL.
  - `[src/shared/processError.ts](src/shared/processError.ts)`: typed process error class and type guard.
  - `[src/types.ts](src/types.ts)`: compile-time-only type helpers for camelizing JS Beautify options.

## Extension Responsibilities vs php-cs-fixer Responsibilities

Extension responsibilities (what we test and can safely change):
- Configuration loading and defaults:
  - Reads `php-cs-fixer.*` settings from VS Code (`executablePath`, `rules`, `config`, `allowRisky`, `pathMode`, `ignorePHPVersion`, `exclude`, `onsave`, `autoFixByBracket`, `autoFixBySemicolon`, `formatHtml`, `documentFormattingProvider`, `tmpDir`, `lastDownload`).
  - Applies platform-specific defaults (Windows vs Unix, `.phar` handling).
  - Resolves VS Code-specific expressions: `${workspaceFolder}`, `${workspaceRoot}`, `${extensionPath}`, `~/`.
- Path and workspace resolution:
  - Chooses workspace folder for a URI in multi-root scenarios.
  - Resolves config file paths (absolute or workspace-relative; root and `.vscode`).
- Argument construction:
  - `getArgs()` decides CLI args: `fix`, `--using-cache=no`, `--format=json`, `--config=...` OR `--rules=...`, `--allow-risky=yes`, `--path-mode=...`, final file path, `.phar` prepend logic.
- Formatting orchestration:
  - Writing temp files for formatting.
  - Running `runAsync()` with correct executable path, args, cwd, env (`PHP_CS_FIXER_IGNORE_ENV`).
  - Handling JSON output, fallback to original text when no changes.
  - Handling errors and mapping meaningful messages to status bar / output channel.
- VS Code integration:
  - Commands: `php-cs-fixer.fix`, `php-cs-fixer.fix2`, `php-cs-fixer.diff`, `php-cs-fixer.showOutput`.
  - Events: `onWillSaveTextDocument`, `onDidChangeTextDocument`, `onDidChangeConfiguration`.
  - Service registration: document formatting / range formatting providers for PHP.
  - Auto-fix behavior on `}` and `;` keypresses.
- File exclusion:
  - Uses `anymatch` against `exclude` glob patterns for files and docs.
- Update behavior:
  - `checkUpdate()` timing logic for downloading `php-cs-fixer.phar` when using `${extensionPath}/php-cs-fixer.phar`.

php-cs-fixer responsibilities (do NOT try to replicate or test exhaustively):
- The actual formatting rules and results (PSR, Symfony, PER-CS, etc.).
- Exact structure or semantics of the JSON output beyond what we consume (`files` array presence/length).
- Exact error messages for non-zero exit codes (we only rely on exit codes and possibly simple pattern matches).
- Validation of user rule sets or config file correctness (we only pass them through).

## Key Files and Their Roles

- `[src/extension.ts](src/extension.ts)`
  - Class `PHPCSFixer`:
    - Holds config fields (implements `PHPCSFixerConfig`).
    - `loadSettings()` pulls from `workspace.getConfiguration('php-cs-fixer')` and sets flags/paths.
    - `resolveVscodeExpressions()` interpolates `${workspaceFolder}`, `${extensionPath}`, `~/` etc.
    - `getActiveWorkspaceFolder()` finds the workspace folder for a URI, with a single-root fallback.
    - `getRealExecutablePath()` resolves the executable path for a URI (including expression resolution).
    - `getArgs()` builds CLI arguments based on effective config and path rules.
    - `format()` orchestrates temp-file-based formatting using `runAsync()` and cleans up on success/failure.
    - `fix()` runs php-cs-fixer directly against a file URI (used by `fix2`/folder command).
    - `diff()` runs `format(..., isDiff=true)` and calls `vscode.diff`.
    - `doAutoFixByBracket()` and `doAutoFixBySemicolon()` implement incremental auto-fix flows.
    - `formattingProvider()` and `rangeFormattingProvider()` implement VS Code formatting interfaces.
    - `isExcluded()` uses `anymatch` against `exclude` for file URIs.
    - `errorTip()` shows error message and optionally opens output channel.
    - `checkUpdate()` schedules a delayed check to auto-download a `.phar` file if configured.
  - `activate(context)`:
    - Instantiates `PHPCSFixer`.
    - Registers event listeners and commands, hooking them to instance methods.
    - Conditionally registers formatting providers based on config.
  - `deactivate()` calls `disposeOutput()` to clean up UI resources.

- `[src/runAsync.ts](src/runAsync.ts)`
  - Single entry for spawning commands.
  - Handles buffer collection, error vs success result mapping via `ProcessError`.
  - Adds logging via `output()` for debugging (command, args, options, final result).

- `[src/output.ts](src/output.ts)`
  - Lazily creates and caches an `OutputChannel`.
  - Manages a singleton status bar item.
  - Utility functions `output()`, `showOutput()`, `clearOutput()`, `statusInfo()`, `hideStatusBar()`, `disposeOutput()`.

- `[src/beautifyHtml.ts](src/beautifyHtml.ts)`
  - Handles mixed HTML/PHP formatting:
    - Uses `php-parser` to tokenize PHP segments.
    - Uses `htmlparser2` to detect script/style tag ranges.
    - Uses `js-beautify` for HTML formatting with custom options.
  - Called from `formattingProvider()` when `formatHtml` is enabled.
  - Logic is non-trivial; avoid changing unless specifically working on HTML formatting.

- `[src/download-phar.ts](src/download-phar.ts)`
  - Downloads `php-cs-fixer-v3.phar` using `fetch`.
  - Writes to a path under the extension directory.
  - On error, removes the partially downloaded file and rethrows.

## Testing Guidance

### Test Runner and Commands

- Tests: `vitest` with config in `[vitest.config.ts](vitest.config.ts)` and setup in `[tests/setup/vitest.setup.ts](tests/setup/vitest.setup.ts)`.
- Typical scripts (see `package.json`):
  - `npm test` → `vitest run`
  - `npm run test:watch` → watch mode
  - `npm run test:coverage` → coverage report (HTML in `coverage/`).

### Test Philosophy

When adding or updating tests:
- Focus on **extension behavior**, not php-cs-fixer internals.
- Prefer **unit tests** for:
  - Config and expression resolution.
  - Argument building decisions.
  - Exclusion and auto-fix decision logic.
  - Error and status handling.
- Use **integration-style tests** sparingly:
  - For `activate()` wiring: commands/events/providers registration.
  - For `PHPCSFixer` flows where VS Code mocks are already set up.
- If you need to simulate php-cs-fixer:
  - Mock `runAsync` to return a minimal `{ stdout, stderr }` where `stdout` is `JSON.stringify({ files: [...] })`.
  - Do **not** rely on real php-cs-fixer behavior in ordinary tests.

### What NOT to Test

- Specific php-cs-fixer rule behavior (how code is reformatted).
- Full JSON schema of php-cs-fixer’s output beyond the `files` array and error conditions we actually use.
- Detailed error messages or exit code semantics beyond what the extension maps to status bar messages and `errorTip()`.

## Modification Guidelines

### General

- Keep changes minimal, localized, and justified.
- Maintain TypeScript strictness consistent with current `tsconfig.json`.
- Run `npm test` (or appropriate subset) after non-trivial changes.
- Keep `dist/index.js` build in sync using `npm run build` when publishing (but do not commit generated artifacts unless the project standard requires it).

### When Working in `extension.ts`

- Avoid growing `PHPCSFixer` even larger:
  - Prefer extracting well-named helpers or new modules when adding complexity.
  - Keep `activate()` thin; it should primarily wire services to VS Code APIs.
- Do not re-implement php-cs-fixer logic; only adjust orchestration and VS Code integration.
- Maintain behavior around:
  - `onsave` vs `editor.formatOnSave` (extension only formats on save when `onsave` is true and editor-level format-on-save is false).
  - Auto-fix guards (language must be PHP, not excluded, document must be file-backed).
  - Diff behavior (uses `vscode.diff` with original URI vs temp file URI).

### When Working in `runAsync.ts`

- Preserve behavior:
  - Non-zero exit → `ProcessError`.
  - Logging to `output()` for observability.
  - Shell behavior on Windows (currently uses `shell: process.platform === 'win32'`).
- Any change here affects all CLI calls; add tests around new behavior.

### When Working in `beautifyHtml.ts`

- This file is complex and uses multiple parsing layers:
  - Only change if working on HTML formatting behavior.
  - Add or adjust tests in `[src/beautifyHtml.test.ts](src/beautifyHtml.test.ts)` if modifying token/escape logic.
  - Keep PHP token handling and comment escaping semantics intact unless clearly improving correctness with tests.

### When Working in `download-phar.ts` and `checkUpdate()`

- Respect user configurations:
  - Auto-download only when `executablePath` equals `${extensionPath}/php-cs-fixer.phar` and `lastDownload` indicates it’s due.
  - Honor disabling auto-download by setting `lastDownload` to 0.
- Use robust error handling:
  - Delete partial `.phar` files on failure.
  - Log errors, but don’t crash the extension.

## Agent Operational Constraints

- Do not:
  - Introduce new runtime dependencies without updating `package.json` and justifying them.
  - Change configuration keys or command IDs without updating `package.json` contributions and tests.
  - Write integration tests that require network access or real php-cs-fixer unless explicitly gated (e.g., by an env flag) and documented as slow/optional.
- Prefer:
  - Editing existing tests and structures rather than introducing parallel, redundant ones.
  - Reusing helper utilities when they exist (`resolveVscodeExpressions`, `getArgs`, `runAsync`, output helpers).

## Quick Checklist for Changes

Before finalizing a non-trivial change, confirm:
- Config behavior:
  - New/changed behavior is reflected in tests.
  - VS Code config keys remain consistent with `package.json`.
- Formatting behavior:
  - `format()`, `formattingProvider()`, and `rangeFormattingProvider()` still handle:
    - No-change cases (returns empty edits or original text).
    - Error cases (JSON parse error, `ProcessError`, ENOENT) gracefully.
    - Temp file cleanup for non-diff, non-partial runs.
- Auto-fix behavior:
  - Early returns still protect from running on non-PHP docs, excluded paths, untitled docs, wrong keys, etc.
- Commands/events:
  - `activate()` still registers commands and providers according to configuration flags.
  - `deactivate()` still disposes output resources.
- Tests:
  - Relevant test suites updated and passing.
  - No tests are added that rely on real `php-cs-fixer` behavior, unless explicitly marked as slow/optional.


