## Architecture Overview

This extension integrates the `php-cs-fixer` CLI into VS Code using a **hybrid
architecture**: functional configuration management combined with object-oriented
services for stateful operations.

### Design Philosophy

**Configuration is Data**: Configuration loading and expression resolution are
pure functions that return immutable objects. This makes them easy to test and
reason about.

**Services are Behavior**: Formatting orchestration and auto-fix logic require
state management (concurrency guards, resource cleanup) and are implemented as
classes with clear responsibilities.

### Runtime entrypoints

- **`src/index.ts`**: exports `activate` / `deactivate`.
- **`src/extension.ts`**:
  - `activate()` is a pure service composition and wiring layer.
  - No classes defined here, just instantiation and registration.
  - Loads config via `loadConfig()`, creates services, wires to VS Code APIs.

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
    - `php-cs-fixer.downloadPhar`
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

### Hybrid Architecture Components

#### Config Module (`src/config.ts`) - **Functional**

Pure functions for configuration management:

**Key Functions:**
- **`loadConfig(): ConfigSchema`**
  - Reads `php-cs-fixer.*` settings from VS Code workspace
  - Applies platform-specific defaults (Windows vs Unix, `.phar` handling)
  - Returns immutable `ConfigSchema` object
  - No side effects, no state

- **`resolveVscodeExpressions(input: string, context?: ResolveContext): string`**
  - Pure function for interpolating `${workspaceFolder}`, `${extensionPath}`, `~/`
  - Takes input string and optional context (URI), returns resolved string
  - Stateless, testable in isolation

- **`getActiveWorkspaceFolder(uri: Uri): WorkspaceFolder | undefined`**
  - Helper for multi-root workspace resolution
  - Returns workspace folder containing URI or single-root fallback
  - Pure lookup, no mutations

**Why Functional?** Configuration is inherently data transformation. Making it
functional ensures:
- **Immutability**: config can't be accidentally mutated
- **Testability**: pass objects, get results, no mocking needed
- **Clear semantics**: `config = loadConfig()` clearly creates new snapshot
- **Thread-safe**: works correctly if VS Code ever supports concurrency

#### FormattingService (`src/formattingService.ts`) - **OO**

Stateful service for formatting orchestration:

**Constructor:** `new FormattingService(config: ConfigSchema)`
- Holds reference to immutable config
- Initializes `isRunning = false` concurrency guard

**Key Methods:**
- `updateConfig(newConfig: ConfigSchema)`: Replace config reference when reloaded
- `format(text, uri, isDiff, isPartial): Promise<string>`: Core formatting
- `fix(uri)`: Direct file formatting
- `diff(uri)`: Generate diff view
- `getArgs(uri, filePath?)`: Build CLI arguments
- `formattingProvider(document, options)`: VS Code provider
- `rangeFormattingProvider(document, range)`: Partial formatting
- `isExcluded(document)`: Check exclusion patterns

**State Management:**
- `isRunning` flag prevents concurrent format operations
- `config` reference updated via `updateConfig()` on settings change
- Temp file cleanup happens in format() finally block

**Why OO?** Formatting requires:
- Concurrency control (`isRunning` flag)
- Resource management (temp files, cleanup)
- Error state tracking
- Natural fit for class with private state

#### AutoFixService (`src/autoFixService.ts`) - **OO**

Auto-fix-on-type behavior:

**Constructor:** `new AutoFixService(formattingService: FormattingService)`
- Depends on FormattingService for actual formatting
- No additional state needed

**Key Methods:**
- `doAutoFixByBracket(event: TextDocumentChangeEvent)`: Fix on `}` keypress
- `doAutoFixBySemicolon(event: TextDocumentChangeEvent)`: Fix on `;` keypress
- Extracts document URI from event, no closure needed

**Why OO?** Encapsulates auto-fix logic, testable via dependency injection.

#### SpawnHelpers (`src/spawnHelpers.ts`) - **Functional**

Platform-aware utilities:

- `buildSpawnOptions(uri, ignorePHPVersion)`: Create spawn opts with env/cwd
- `quoteArgForPlatform(arg, platform?)`: Windows vs Unix argument quoting

**Why Functional?** Pure utilities with no state.

#### Extension Activation (`src/extension.ts`) - **Functional Composition**

Pure service wiring:

```typescript
export function activate(context: ExtensionContext) {
  // Load immutable config
  let config = loadConfig()
  
  // Create services
  const formattingService = new FormattingService(config)
  const autoFixService = new AutoFixService(formattingService)
  
  // Standalone update check
  checkUpdate(config)
  
  // Config reload
  const reloadConfig = () => {
    config = loadConfig()
    formattingService.updateConfig(config)
  }
  
  // Register handlers and providers
  context.subscriptions.push(
    workspace.onDidChangeConfiguration(reloadConfig),
    // ... other event handlers
  )
}
```

### Data Flow

**Format Document:**
```
User Action (format/save)
  ↓
activate() event handler
  ↓
FormattingService.formattingProvider(document)
  ↓
├─ FormattingService.format(text, uri)
│  ├─ Create temp file
│  ├─ getArgs(uri) → build CLI args using config
│  ├─ buildSpawnOptions(uri) → spawn opts
│  ├─ runAsync(executable, args, opts)
│  ├─ Parse JSON output
│  ├─ Cleanup temp files
│  └─ Return formatted text
│
└─ Return TextEdit[] to VS Code
```

**Configuration Reload:**
```
Settings changed
  ↓
onDidChangeConfiguration event
  ↓
config = loadConfig()  // New immutable snapshot
  ↓
formattingService.updateConfig(config)  // Update reference
```

### Testing Strategy

**Config Module:** Test pure functions with object inputs/outputs
```typescript
import { loadConfig, resolveVscodeExpressions } from './config'

const result = resolveVscodeExpressions('${extensionPath}/foo')
expect(result).toBe('/path/to/extension/foo')
```

**Services:** Inject config object, mock FormattingService methods
```typescript
import { loadConfig } from './config'
import { FormattingService } from './formattingService'

const config = loadConfig() // or create test fixture
const service = new FormattingService(config)
vi.spyOn(service, 'format').mockResolvedValue('formatted')
```

**Integration:** Test activate() wires services correctly to VS Code APIs

### Benefits of Hybrid Approach

1. **Best of Both Worlds**
   - Functional where it makes sense (config, utilities)
   - OO where state is needed (formatting, auto-fix)

2. **Improved Testability**
   - Config functions test without mocks
   - Services test with simple object injection
   - No complex class hierarchies

3. **Clear Semantics**
   - `loadConfig()` always creates fresh snapshot
   - `updateConfig()` explicitly updates references
   - No hidden mutations

4. **Maintainability**
   - Each module has single responsibility
   - Dependencies are explicit
   - Easy to reason about data flow

This architecture preserves user-visible behavior and configuration keys
while maximizing testability and maintainability.
