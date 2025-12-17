import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('vscode', () => {
	class ExtensionContext {
		subscriptions: any[] = []
	}

	return {
		commands: {
			registerCommand: vi.fn(),
			registerTextEditorCommand: vi.fn(),
			executeCommand: vi.fn(),
		},
		languages: {
			registerDocumentFormattingEditProvider: vi.fn(),
			registerDocumentRangeFormattingEditProvider: vi.fn(),
		},
		workspace: {
			getConfiguration: vi.fn(),
			getWorkspaceFolder: vi.fn(),
			workspaceFolders: undefined,
			onWillSaveTextDocument: vi.fn(() => ({ dispose: () => {} })),
			onDidChangeTextDocument: vi.fn(() => ({ dispose: () => {} })),
			onDidChangeConfiguration: vi.fn(() => ({ dispose: () => {} })),
		},
		window: {
			activeTextEditor: null,
			showErrorMessage: vi.fn(),
		},
		Uri: {
			file: vi.fn((p: string) => ({ fsPath: p, scheme: 'file', path: p })),
			joinPath: vi.fn((...args: any[]) => ({
				fsPath: args[args.length - 1],
				scheme: 'file',
			})),
		},
		TextEdit: {
			replace: vi.fn((range: any, text: string) => ({ range, newText: text })),
		},
		Position: class Position {
			constructor(
				public line: number,
				public character: number,
			) {}
		},
		Range: class Range {
			constructor(
				public start: any,
				public end: any,
			) {}
		},
		StatusBarAlignment: { Left: 1, Right: 2 },
		ExtensionContext,
	}
})

vi.mock('node:fs')
vi.mock('node:fs/promises')
vi.mock('anymatch', () => ({
	default: (patterns: string | string[], input: string) => {
		if (!input) return false
		const patternList = Array.isArray(patterns) ? patterns : [patterns]

		for (const pattern of patternList) {
			// Handle ** glob star patterns like "vendor/**" or "node_modules/**"
			if (pattern.endsWith('/**')) {
				const prefix = pattern.slice(0, -3) // Remove "/**"
				if (input.includes(prefix)) {
					return true
				}
			}
			// Handle * wildcard suffix patterns like "*.backup.php"
			if (pattern.startsWith('*') && !pattern.includes('/')) {
				const suffix = pattern.slice(1)
				if (input.endsWith(suffix)) {
					return true
				}
			}
			// Handle exact match
			if (input === pattern) {
				return true
			}
		}
		return false
	},
}))
vi.mock('./beautifyHtml')
vi.mock('./download-phar')
vi.mock('./output')
vi.mock('./runAsync')

import * as vscode from 'vscode'

import { PHPCSFixer } from './extension'

describe('PHPCSFixer.isExcluded()', () => {
	let mockConfig: any

	beforeEach(() => {
		vi.clearAllMocks()
		mockConfig = createMockConfig({})
		setupMockWorkspace(mockConfig)
	})

	function createMockConfig(overrides: Record<string, any> = {}) {
		return {
			get: vi.fn((key, defaultValue) => {
				const defaults: Record<string, any> = {
					onsave: false,
					autoFixByBracket: true,
					autoFixBySemicolon: false,
					executablePath: 'php-cs-fixer',
					executablePathWindows: '',
					rules: '@PSR12',
					config: '',
					formatHtml: false,
					documentFormattingProvider: true,
					allowRisky: false,
					pathMode: 'override',
					ignorePHPVersion: false,
					exclude: [],
					tmpDir: '',
					...overrides,
				}
				return defaults[key] ?? defaultValue
			}),
		}
	}

	function setupMockWorkspace(config: any) {
		;(vscode.workspace.getConfiguration as any).mockImplementation((section: string) => {
			if (section === 'editor') {
				return {
					get: vi.fn((key) => (key === 'formatOnSave' ? false : undefined)),
				}
			}
			if (section === 'php') {
				return {
					get: vi.fn((key) => (key === 'validate.executablePath' ? '' : undefined)),
				}
			}
			return config
		})
		;(vscode.workspace.getWorkspaceFolder as any).mockReturnValue(undefined)
		;(vscode.workspace as any).workspaceFolders = undefined
	}

	it('returns false if no exclude patterns configured', () => {
		const fixer = new PHPCSFixer()
		const document = {
			uri: { path: '/workspace/vendor/package.php', scheme: 'file' },
			languageId: 'php',
			isUntitled: false,
		}
		expect(fixer.isExcluded(document as any)).toBe(false)
	})

	it('returns false for untitled documents', () => {
		mockConfig = createMockConfig({ exclude: ['vendor/**'] })
		setupMockWorkspace(mockConfig)
		const fixer = new PHPCSFixer()
		const document = {
			uri: { path: 'untitled:1', scheme: 'untitled' },
			languageId: 'php',
			isUntitled: true,
		}
		expect(fixer.isExcluded(document as any)).toBe(false)
	})

	it('returns false for non-file scheme URIs', () => {
		mockConfig = createMockConfig({ exclude: ['vendor/**'] })
		setupMockWorkspace(mockConfig)
		const fixer = new PHPCSFixer()
		const document = {
			uri: { path: 'ssh://remote/vendor/file.php', scheme: 'ssh' },
			languageId: 'php',
			isUntitled: false,
		}
		expect(fixer.isExcluded(document as any)).toBe(false)
	})

	it('excludes files matching vendor/** pattern', () => {
		mockConfig = createMockConfig({ exclude: ['vendor/**'] })
		setupMockWorkspace(mockConfig)
		const fixer = new PHPCSFixer()
		const document = {
			uri: { path: '/workspace/vendor/package/file.php', scheme: 'file' },
			languageId: 'php',
			isUntitled: false,
		}
		expect(fixer.isExcluded(document as any)).toBe(true)
	})

	it('excludes files matching node_modules/** pattern', () => {
		mockConfig = createMockConfig({ exclude: ['node_modules/**'] })
		setupMockWorkspace(mockConfig)
		const fixer = new PHPCSFixer()
		const document = {
			uri: { path: '/workspace/node_modules/pkg/index.php', scheme: 'file' },
			languageId: 'php',
			isUntitled: false,
		}
		expect(fixer.isExcluded(document as any)).toBe(true)
	})

	it('excludes files matching tests/** pattern', () => {
		mockConfig = createMockConfig({ exclude: ['tests/**'] })
		setupMockWorkspace(mockConfig)
		const fixer = new PHPCSFixer()
		const document = {
			uri: { path: '/workspace/tests/Unit/SomeTest.php', scheme: 'file' },
			languageId: 'php',
			isUntitled: false,
		}
		expect(fixer.isExcluded(document as any)).toBe(true)
	})

	it('does not exclude files not matching pattern', () => {
		mockConfig = createMockConfig({ exclude: ['vendor/**', 'node_modules/**'] })
		setupMockWorkspace(mockConfig)
		const fixer = new PHPCSFixer()
		const document = {
			uri: { path: '/workspace/src/MyClass.php', scheme: 'file' },
			languageId: 'php',
			isUntitled: false,
		}
		expect(fixer.isExcluded(document as any)).toBe(false)
	})

	it('handles multiple exclude patterns', () => {
		mockConfig = createMockConfig({ exclude: ['vendor/**', 'node_modules/**', '*.backup.php'] })
		setupMockWorkspace(mockConfig)
		const fixer = new PHPCSFixer()

		// Should match vendor pattern
		const vendorDoc = {
			uri: { path: '/workspace/vendor/package/file.php', scheme: 'file' },
			languageId: 'php',
			isUntitled: false,
		}
		expect(fixer.isExcluded(vendorDoc as any)).toBe(true)

		// Should match node_modules pattern
		const nodeDoc = {
			uri: { path: '/workspace/node_modules/pkg/index.php', scheme: 'file' },
			languageId: 'php',
			isUntitled: false,
		}
		expect(fixer.isExcluded(nodeDoc as any)).toBe(true)

		// Should not match any pattern
		const srcDoc = {
			uri: { path: '/workspace/src/MyClass.php', scheme: 'file' },
			languageId: 'php',
			isUntitled: false,
		}
		expect(fixer.isExcluded(srcDoc as any)).toBe(false)
	})
})
