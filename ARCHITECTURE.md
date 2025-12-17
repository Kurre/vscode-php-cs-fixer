## Architecture Overview

This extension integrates the `php-cs-fixer` CLI into VS Code. It focuses on
configuration, orchestration and VS Code wiring, and delegates actual code
formatting behavior to `php-cs-fixer`.

### Runtime entrypoints

- **`src/index.ts`**: exports `activate` / `deactivate`.
- **`src/extension.ts`**:
  - Class `PHPCSFixer` owns most extension behavior.
  - `activate` wires VS Code events and commands to a `PHPCSFixer` instance.

### Current responsibilities

#### Extension responsibilities (owned and tested here)

- **Configuration loading and defaults**
  - Reads `php-cs-fixer.*` settings from VS Code:
    - `executablePath`, `executablePathWindows`
    - `rules`, `config`, `allowRisky`, `pathMode`, `ignorePHPVersion`
    - `exclude`, `onsave`, `autoFixByBracket`, `autoFixBySemicolon`
    - `formatHtml`, `documentFormattingProvider`, `tmpDir`, `lastDownload`
  - Applies platform-specific defaults (Windows vs Unix, `.phar` handling).
  - Resolves VS Code expressions: `${workspaceFolder}`, `${workspaceRoot}`,
    `${extensionPath}`, `~/`.

- **Path and workspace resolution**
  - Chooses the workspace folder for a given URI in single- vs multi-root
    workspaces.
  - Resolves config file paths:
    - absolute
    - workspace-root relative
    - `.vscode` folder relative.

- **Argument construction**
  - Builds CLI arguments for `php-cs-fixer`:
    - `fix`, `--using-cache=no`, `--format=json`
    - `--config=...` or `--rules=...`
    - `--allow-risky=yes` (when enabled)
    - `--path-mode=...`
    - final file path
  - Handles `.phar` + `php` executable composition.

- **Formatting orchestration**
  - Writes temp files for formatting (full and partial).
  - Calls `runAsync()` with executable, args, cwd and env
    (`PHP_CS_FIXER_IGNORE_ENV`).
  - Interprets JSON output and decides whether to return original or formatted
    text.
  - Handles `diff` mode and temporary file cleanup.
  - Maps errors and statuses to the status bar and output channel.

- **HTML beautification (optional)**
  - When `php-cs-fixer.formatHtml` is `true`, the extension runs `beautifyHtml`
    on the current document before invoking php-cs-fixer.
  - This is treated as an optional, configuration-driven feature layered on top
    of the core php-cs-fixer integration.

- **VS Code integration**
  - Commands:
    - `php-cs-fixer.fix`
    - `php-cs-fixer.fix2`
    - `php-cs-fixer.diff`
    - `php-cs-fixer.showOutput`
  - Events:
    - `onWillSaveTextDocument`
    - `onDidChangeTextDocument`
    - `onDidChangeConfiguration`
  - Providers:
    - document formatting / range formatting for PHP documents.

- **Auto-fix behavior**
  - Auto-fix on `}` using `doAutoFixByBracket`.
  - Auto-fix on `;` using `doAutoFixBySemicolon`.
  - Guards around language id, excluded files and untitled documents.

- **File exclusion**
  - Uses `anymatch` against `exclude` patterns for documents and URIs.

- **Update behavior**
  - `checkUpdate()` decides when to auto-download `php-cs-fixer.phar` to the
    extension folder when configured using `${extensionPath}/php-cs-fixer.phar`.

#### php-cs-fixer responsibilities (delegated to CLI)

- Applying all formatting rules (PSR, Symfony, PER-CS, etc.).
- Exact JSON output structure beyond what the extension reads:
  - presence and `length` of the `files` array.
- Detailed error messages and exit code semantics.
- Validation of user rule sets and configuration files.

### Target architecture (incremental refactor)

The goal is to move from a single large `PHPCSFixer` class to focused services
that can be tested in isolation:

- **ConfigService**
  - Encapsulates configuration loading and defaults.
  - Implements expression/workspace resolution.
  - Provides a typed `ConfigSchema` and an “effective config” view for
    diagnostics.

- **FormattingService**
  - Owns temporary file creation/cleanup and formatting orchestration.
  - Wraps `getArgs()` and `runAsync()`.
  - Interprets JSON output and maps `ProcessError` / exit codes to
    user-visible messages.
  - Contains a concurrency guard instead of relying on module-level state.

- **AutoFixService**
  - Hosts `doAutoFixByBracket()` and `doAutoFixBySemicolon()` and any
    associated parsing/regex helpers.
  - Depends on `FormattingService` via a small interface so it can be unit
    tested.

- **Command / activation wiring**
  - `activate()` becomes a thin composition layer:
    - instantiates services
    - wires VS Code events and commands to those services
    - registers formatting and range providers.
  - `deactivate()` remains responsible for cleaning up output resources.

This refactor is intended to be incremental, preserving user-visible behavior
and existing configuration keys while increasing testability and clarity.

