# Test Coverage Analysis & Improvement Plan

## Extension Logic Analysis

### 1. **PHPCSFixer / Services** (Core Business Logic)

Current implementation centralises most behavior in `PHPCSFixer`. The target
architecture is to keep the same externally visible behavior while gradually
moving logic into focused services (e.g. `ConfigService`, `FormattingService`,
`AutoFixService`) that can be tested in isolation.

Main extension responsibilities to cover with tests:

- **Configuration & Setup**
  - `loadSettings()` – loads config from workspace with platform-specific defaults.
  - `resolveVscodeExpressions()` – expands `${extensionPath}`, `${workspaceFolder}`, `~/` paths.
  - `getActiveWorkspaceFolder()` – returns correct workspace folder or falls back to single root.

- **Command Building**
  - `getArgs()` – generates correct CLI arguments based on config.
  - `getRealExecutablePath()` – resolves executable path with expressions.

- **Core Formatting**
  - `format()` – executes php-cs-fixer and handles output.
  - `formattingProvider()` – document-wide formatting (implements VS Code interface).
  - `rangeFormattingProvider()` – partial document formatting.
  - `fix()` – direct file fixing.
  - `diff()` – shows diff output.

- **Auto-fix Features**
  - `doAutoFixByBracket()` – triggers on closing bracket.
  - `doAutoFixBySemicolon()` – triggers on semicolon.
  - `isExcluded()` – checks anymatch patterns against file path.

- **Utilities**
  - `checkUpdate()` – periodic update check.
  - `errorTip()` – error message display.

### 2. **Extension Activation** (`activate()`)
- Creates PHPCSFixer instance
- Registers event listeners (onWillSaveTextDocument, onDidChangeTextDocument, onDidChangeConfiguration)
- Registers commands (fix, fix2, diff, showOutput)
- Conditionally registers formatting providers based on config

### 3. **Extension Deactivation** (`deactivate()`)
- Cleans up output channel

---

## Current Test Coverage

### What's Tested:
- ✅ Configuration loading (`loadSettings`) including platform-specific executable resolution and phar handling
- ✅ VSCode expression resolution and workspace-dependent paths (`resolveVscodeExpressions`, parts of `loadSettings`)
- ✅ Command argument building (`getArgs`) including rules/config precedence, `--allow-risky`, path modes, temp files, and Windows path handling
- ✅ Core formatting, diff and fix flows (`format`, `formattingProvider`, `rangeFormattingProvider`, `fix`, `diff`) including exclusions and partial formatting
- ✅ Auto-fix bracket/semicolon behavior (`doAutoFixByBracket`, `doAutoFixBySemicolon`) including early-return guards and happy-path flows
- ✅ File exclusion logic (`isExcluded`) and anymatch integration via formatting and auto-fix tests
- ✅ Process execution and error propagation (`runAsync`) and process error handling (`processError`)
- ✅ HTML beautification and output helpers (`beautifyHtml`, `output`)
- ✅ Phar download helper (`download-phar`)
- ✅ Extension activation & integration (`activate`/`deactivate`): event listeners, command registration, provider registration, and subscription wiring

### What's NOT Tested:
- ❌ `checkUpdate()` behavior (phar auto-download timing, lastDownload timestamp handling, and error paths)
- ❌ `errorTip()` user interaction flow (message text, "Open Output" action, and command wiring)
- ❌ Some error and edge cases in `format()`/`fix()` (deep JSON parse failures, complex ENOENT scenarios, non-file URIs)
- ❌ Broader multi-root workspace behavior beyond the scenarios covered in existing expression/workspace tests
- ❌ Full platform matrix (Windows vs Unix) beyond the targeted `process.platform` checks in unit tests

---

## Comprehensive Test Plan

### Phase 1: Configuration & Setup Tests

#### 1.1 `loadSettings()` Tests
- [ ] Loads onsave setting with default false
- [ ] Loads autoFixByBracket with default true
- [ ] Loads autoFixBySemicolon with default false
- [ ] Loads executablePath with platform-specific defaults
- [ ] Windows: Uses php-cs-fixer.bat by default
- [ ] Unix: Uses php-cs-fixer by default
- [ ] Windows: Overrides with executablePathWindows if set
- [ ] Loads rules with default @PSR12
- [ ] Converts rules object to JSON string
- [ ] Loads config file paths with default fallback
- [ ] Loads formatHtml setting
- [ ] Loads documentFormattingProvider setting
- [ ] Loads allowRisky setting
- [ ] Loads pathMode setting
- [ ] Loads ignorePHPVersion setting
- [ ] Loads exclude patterns array
- [ ] Loads tmpDir and falls back correctly
- [ ] Resolves executablePath through expressions
- [ ] Handles .phar files specially

#### 1.2 `resolveVscodeExpressions()` Tests
- [ ] Expands ${extensionPath} to __dirname
- [ ] Expands ~ to home directory
- [ ] Expands ${workspaceFolder} with proper workspace folder
- [ ] Falls back for multi-root workspaces when URI provided
- [ ] Normalizes path slashes on Windows
- [ ] Handles missing workspaceFolder gracefully
- [ ] Doesn't expand expressions if context not available
- [ ] Returns normalized paths

#### 1.3 `getActiveWorkspaceFolder()` Tests
- [ ] Returns workspace folder containing URI
- [ ] Falls back to single workspace folder when appropriate
- [ ] Returns undefined for multi-root without matching folder
- [ ] Handles file scheme URIs
- [ ] Handles non-file scheme URIs

### Phase 2: Command Building & Execution Tests

#### 2.1 `getArgs()` Tests
- [ ] Includes 'fix' command
- [ ] Includes '--using-cache=no'
- [ ] Includes '--format=json'
- [ ] Prepends .phar path when configured
- [ ] Uses config file if exists in workspace
- [ ] Searches .vscode directory for config
- [ ] Searches workspace root for config
- [ ] Falls back to rules if no config found
- [ ] Adds '--allow-risky=yes' when enabled
- [ ] Sets '--path-mode=override' for temp files
- [ ] Uses configured pathMode for real files
- [ ] Includes file path as last argument
- [ ] Handles Windows paths with quotes
- [ ] Handles rules object as JSON
- [ ] Prioritizes config over rules

#### 2.2 `getRealExecutablePath()` Tests
- [ ] Resolves expressions in executable path
- [ ] Returns undefined for invalid paths
- [ ] Maintains path context with URI

### Phase 3: Formatting & Fixing Logic Tests

#### 3.1 `format()` Tests
- [ ] Returns promise with formatted text
- [ ] Creates temp directory successfully
- [ ] Falls back to HOME_DIR if TEMP_DIR fails
- [ ] Parses JSON output from php-cs-fixer
- [ ] Returns original text if no changes
- [ ] Sets isRunning flag correctly
- [ ] Calls clearOutput and statusInfo
- [ ] Cleans up temp files after formatting
- [ ] Handles format errors gracefully
- [ ] Handles JSON parse errors
- [ ] Rejects promise on PHP errors
- [ ] Shows appropriate error messages
- [ ] Handles ENOENT errors (executable not found)
- [ ] Sets different temp file for partial formatting
- [ ] Handles ProcessError with exit codes

#### 3.2 `fix()` Tests
- [ ] Spawns process with correct arguments
- [ ] Sets working directory correctly
- [ ] Shows success status after fix
- [ ] Handles errors appropriately
- [ ] Handles ENOENT errors

#### 3.3 `formattingProvider()` Tests
- [ ] Respects file exclusions
- [ ] Returns empty array for excluded files
- [ ] Formats entire document
- [ ] Returns TextEdit array with changes
- [ ] Returns empty array when no changes
- [ ] Handles HTML beautification when enabled
- [ ] Merges HTML format settings
- [ ] Respects editorFormatOnSave configuration

#### 3.4 `rangeFormattingProvider()` Tests
- [ ] Formats only specified range
- [ ] Returns TextEdit for the range
- [ ] Adds PHP opening tag if missing
- [ ] Removes added PHP tag from result
- [ ] Respects file exclusions
- [ ] Rejects for whitespace-only ranges
- [ ] Handles empty ranges

#### 3.5 `diff()` Tests
- [ ] Calls format with isDiff=true
- [ ] Executes vscode.diff command
- [ ] Passes correct file URIs
- [ ] Handles format errors

### Phase 4: Auto-fix Features Tests

#### 4.1 `doAutoFixByBracket()` Tests
- [ ] Returns early if no content changes
- [ ] Returns early if no active editor
- [ ] Returns early if not closing bracket
- [ ] Jumps to matching bracket
- [ ] Formats code block correctly
- [ ] Handles function declarations
- [ ] Handles if/for/foreach/while statements
- [ ] Handles class/trait/interface declarations
- [ ] Handles try/catch blocks
- [ ] Handles do/while blocks
- [ ] Applies formatting only if changes detected
- [ ] Cancels selection after edit
- [ ] Falls back gracefully on errors

#### 4.2 `doAutoFixBySemicolon()` Tests
- [ ] Returns early if no content changes
- [ ] Returns early if not semicolon
- [ ] Returns early if no active editor
- [ ] Returns early for short lines
- [ ] Only formats if semicolon at end of line
- [ ] Formats with proper indentation
- [ ] Applies formatting only if changes detected
- [ ] Cancels selection after edit
- [ ] Handles errors gracefully

### Phase 5: Utility Tests

#### 5.1 `isExcluded()` Tests
- [ ] Returns false if no exclude patterns
- [ ] Returns false for non-file URIs
- [ ] Returns false for untitled documents
- [ ] Uses anymatch to check patterns
- [ ] Returns true for matching patterns
- [ ] Handles multiple patterns

#### 5.2 `errorTip()` Tests
- [ ] Shows error message with correct text
- [ ] Offers "Open Output" action
- [ ] Opens output when action selected

#### 5.3 `checkUpdate()` Tests
- [ ] Runs after 1 minute timeout
- [ ] Checks last download timestamp
- [ ] Downloads phar file if needed
- [ ] Updates lastDownload timestamp
- [ ] Handles download errors gracefully
- [ ] Only checks if using phar path from extension

### Phase 6: Integration Tests (activate/deactivate)

#### 6.1 `activate()` Tests
- [ ] Creates PHPCSFixer instance
- [ ] Registers onWillSaveTextDocument listener
- [ ] Registers onDidChangeTextDocument listener
- [ ] Registers onDidChangeConfiguration listener
- [ ] Registers 'php-cs-fixer.fix' command
- [ ] Registers 'php-cs-fixer.fix2' command
- [ ] Registers 'php-cs-fixer.diff' command
- [ ] Registers 'php-cs-fixer.showOutput' command
- [ ] Conditionally registers formatting providers
- [ ] All subscriptions added to context
- [ ] Commands execute correct formatting provider

#### 6.2 `deactivate()` Tests
- [ ] Calls disposeOutput

---

## Priority Implementation Order

### High Priority (Core Logic)
1. Configuration loading tests **(largely covered by `extension.loadSettings.test.ts`)**
2. VSCode expression resolution tests **(largely covered by `extension.expressions.test.ts` and loadSettings tests)**
3. Command argument building tests **(implemented in `extension.getArgs.test.ts`)**
4. Formatting provider tests **(implemented in `extension.formatting.test.ts`)**
5. File exclusion tests **(implemented in `extension.isExcluded.test.ts` and formatting/auto-fix tests)**

### Medium Priority (Features)
6. Auto-fix bracket/semicolon tests **(implemented in `extension.autoFix.test.ts`)**
7. Format and fix command tests **(implemented in `extension.formatting.test.ts`)**
8. Error handling tests **(partially covered; remaining gaps around JSON parse errors and complex process failures)**
9. Event listener tests **(implemented in `extension.events.test.ts` and `extension.test.ts`)**

### Lower Priority (Utilities)
10. Update checking tests **(still to be implemented; `checkUpdate()` has no dedicated tests)**
11. Error tip tests **(still to be implemented; `errorTip()` has no dedicated tests)**
12. Diff command tests **(core behavior covered in `extension.formatting.test.ts` and `extension.events.test.ts`; additional edge cases optional)**

---

## Test Implementation Approach

### 1. Test files by feature (current state)
- `extension.loadSettings.test.ts`
- `extension.expressions.test.ts`
- `extension.formatting.test.ts`
- `extension.autofix.test.ts`
- `extension.integration.test.ts`

### 2. Improve mocking strategy
- Mock `workspace.getConfiguration()` to return specific values per test
- Mock `fs` operations with realistic behavior
- Mock `runAsync()` to simulate php-cs-fixer output
- Mock `window.activeTextEditor` for auto-fix tests

### 3. Test data
- Create fixtures for config scenarios
- Create sample PHP code for formatting tests
- Create error response scenarios

### 4. Coverage targets
- Line coverage: ≥ 80%
- Branch coverage: ≥ 75%
- Function coverage: 100%
- Statement coverage: ≥ 80%
