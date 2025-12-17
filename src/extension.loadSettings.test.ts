import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock vscode first before any other imports
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
vi.mock('anymatch')
vi.mock('./beautifyHtml')
vi.mock('./download-phar')
vi.mock('./output')
vi.mock('./runAsync')

import * as vscode from 'vscode'

import { PHPCSFixer } from './extension'

describe('PHPCSFixer.loadSettings()', () => {
	let mockConfig: any
	let phpCSFixer: PHPCSFixer

	beforeEach(() => {
		vi.clearAllMocks()

		// Setup default configuration mock
		mockConfig = {
			get: vi.fn((key, defaultValue) => {
				const configMap: Record<string, any> = {
					onsave: false,
					autoFixByBracket: true,
					autoFixBySemicolon: false,
					executablePath: 'php-cs-fixer',
					executablePathWindows: '',
					rules: '@PSR12',
					config: '.php-cs-fixer.php;.php-cs-fixer.dist.php;.php_cs;.php_cs.dist',
					formatHtml: false,
					documentFormattingProvider: true,
					allowRisky: false,
					pathMode: 'override',
					ignorePHPVersion: false,
					exclude: [],
					tmpDir: '',
				}
				return configMap[key] ?? defaultValue
			}),
		}

		;(vscode.workspace.getConfiguration as any).mockReturnValue(mockConfig)
		;(vscode.workspace.getConfiguration as any).mockImplementation((section: string) => {
			if (section === 'editor') {
				return {
					get: vi.fn((key, defaultValue) => {
						const editorConfig: Record<string, any> = {
							formatOnSave: false,
						}
						return editorConfig[key] ?? defaultValue
					}),
				}
			}
			if (section === 'php') {
				return {
					get: vi.fn((key, defaultValue) => {
						const phpConfig: Record<string, any> = {
							'validate.executablePath': '',
						}
						return phpConfig[key] ?? defaultValue
					}),
				}
			}
			return mockConfig
		})

		phpCSFixer = new PHPCSFixer()
	})

	describe('Basic configuration loading', () => {
		it('loads onsave setting with default false', () => {
			expect(phpCSFixer.onsave).toBe(false)
		})

		it('loads autoFixByBracket with default true', () => {
			expect(phpCSFixer.autoFixByBracket).toBe(true)
		})

		it('loads autoFixBySemicolon with default false', () => {
			expect(phpCSFixer.autoFixBySemicolon).toBe(false)
		})

		it('loads formatHtml setting', () => {
			expect(phpCSFixer.formatHtml).toBe(false)
		})

		it('loads documentFormattingProvider setting', () => {
			expect(phpCSFixer.documentFormattingProvider).toBe(true)
		})

		it('loads allowRisky setting', () => {
			expect(phpCSFixer.allowRisky).toBe(false)
		})

		it('loads pathMode setting', () => {
			expect(phpCSFixer.pathMode).toBe('override')
		})

		it('loads ignorePHPVersion setting', () => {
			expect(phpCSFixer.ignorePHPVersion).toBe(false)
		})

		it('loads exclude array setting', () => {
			expect(phpCSFixer.exclude).toEqual([])
			expect(Array.isArray(phpCSFixer.exclude)).toBe(true)
		})

		it('loads tmpDir setting', () => {
			expect(phpCSFixer.tmpDir).toBe('')
		})
	})

	describe('Executable path platform-specific defaults', () => {
		it('uses php-cs-fixer.bat on Windows by default', () => {
			const originalPlatform = process.platform
			Object.defineProperty(process, 'platform', {
				value: 'win32',
				configurable: true,
			})

			const win32Fixer = new PHPCSFixer()
			// Should be php-cs-fixer unless overridden
			expect(typeof win32Fixer.executablePath).toBe('string')

			Object.defineProperty(process, 'platform', {
				value: originalPlatform,
				configurable: true,
			})
		})

		it('uses php-cs-fixer on Unix by default', () => {
			expect(typeof phpCSFixer.executablePath).toBe('string')
		})

		it('loads executablePathWindows override on Windows', () => {
			mockConfig.get = vi.fn((key, defaultValue) => {
				const configMap: Record<string, any> = {
					onsave: false,
					autoFixByBracket: true,
					autoFixBySemicolon: false,
					executablePath: 'php-cs-fixer',
					executablePathWindows: '/custom/path/fixer.bat',
					rules: '@PSR12',
					config: '.php-cs-fixer.php',
					formatHtml: false,
					documentFormattingProvider: true,
					allowRisky: false,
					pathMode: 'override',
					ignorePHPVersion: false,
					exclude: [],
					tmpDir: '',
				}
				return configMap[key] ?? defaultValue
			})

			const originalPlatform = process.platform
			Object.defineProperty(process, 'platform', {
				value: 'win32',
				configurable: true,
			})

			const win32Fixer = new PHPCSFixer()
			expect(win32Fixer.executablePath).toContain('/custom/path/fixer.bat')

			Object.defineProperty(process, 'platform', {
				value: originalPlatform,
				configurable: true,
			})
		})

		it('ignores executablePathWindows on non-Windows', () => {
			mockConfig.get = vi.fn((key, defaultValue) => {
				const configMap: Record<string, any> = {
					onsave: false,
					autoFixByBracket: true,
					autoFixBySemicolon: false,
					executablePath: 'php-cs-fixer',
					executablePathWindows: '/custom/path/fixer.bat',
					rules: '@PSR12',
					config: '.php-cs-fixer.php',
					formatHtml: false,
					documentFormattingProvider: true,
					allowRisky: false,
					pathMode: 'override',
					ignorePHPVersion: false,
					exclude: [],
					tmpDir: '',
				}
				return configMap[key] ?? defaultValue
			})

			const unixFixer = new PHPCSFixer()
			expect(unixFixer.executablePath).not.toContain('fixer.bat')
		})
	})

	describe('Rules configuration', () => {
		it('loads rules with default @PSR12', () => {
			expect(phpCSFixer.rules).toBe('@PSR12')
		})

		it('converts rules object to JSON string', () => {
			mockConfig.get = vi.fn((key, defaultValue) => {
				const configMap: Record<string, any> = {
					onsave: false,
					autoFixByBracket: true,
					autoFixBySemicolon: false,
					executablePath: 'php-cs-fixer',
					executablePathWindows: '',
					rules: { array_syntax: { syntax: 'short' }, trailing_comma_in_multiline: true },
					config: '.php-cs-fixer.php',
					formatHtml: false,
					documentFormattingProvider: true,
					allowRisky: false,
					pathMode: 'override',
					ignorePHPVersion: false,
					exclude: [],
					tmpDir: '',
				}
				return configMap[key] ?? defaultValue
			})

			const objectRulesFixer = new PHPCSFixer()
			expect(typeof objectRulesFixer.rules).toBe('string')
			expect(JSON.parse(objectRulesFixer.rules as string)).toEqual({
				array_syntax: { syntax: 'short' },
				trailing_comma_in_multiline: true,
			})
		})
	})

	describe('Config file paths', () => {
		it('loads config file paths with default fallback', () => {
			expect(phpCSFixer.config).toBe('.php-cs-fixer.php;.php-cs-fixer.dist.php;.php_cs;.php_cs.dist')
		})

		it('loads custom config path', () => {
			mockConfig.get = vi.fn((key, defaultValue) => {
				const configMap: Record<string, any> = {
					onsave: false,
					autoFixByBracket: true,
					autoFixBySemicolon: false,
					executablePath: 'php-cs-fixer',
					executablePathWindows: '',
					rules: '@PSR12',
					config: '.custom-fixer.php',
					formatHtml: false,
					documentFormattingProvider: true,
					allowRisky: false,
					pathMode: 'override',
					ignorePHPVersion: false,
					exclude: [],
					tmpDir: '',
				}
				return configMap[key] ?? defaultValue
			})

			const customFixer = new PHPCSFixer()
			expect(customFixer.config).toBe('.custom-fixer.php')
		})
	})

	describe('Expression resolution in paths', () => {
		it('resolves executablePath through expressions', () => {
			mockConfig.get = vi.fn((key, defaultValue) => {
				const configMap: Record<string, any> = {
					onsave: false,
					autoFixByBracket: true,
					autoFixBySemicolon: false,
					executablePath: '${extensionPath}/php-cs-fixer',
					executablePathWindows: '',
					rules: '@PSR12',
					config: '.php-cs-fixer.php',
					formatHtml: false,
					documentFormattingProvider: true,
					allowRisky: false,
					pathMode: 'override',
					ignorePHPVersion: false,
					exclude: [],
					tmpDir: '',
				}
				return configMap[key] ?? defaultValue
			})

			const exprFixer = new PHPCSFixer()
			expect(exprFixer.executablePath).not.toContain('${extensionPath}')
			expect(exprFixer.executablePath).toContain('php-cs-fixer')
		})
	})

	describe('.phar file handling', () => {
		it('extracts phar path and sets executablePath to php', () => {
			mockConfig.get = vi.fn((key, defaultValue) => {
				const configMap: Record<string, any> = {
					onsave: false,
					autoFixByBracket: true,
					autoFixBySemicolon: false,
					executablePath: 'php ${extensionPath}/php-cs-fixer.phar',
					executablePathWindows: '',
					rules: '@PSR12',
					config: '.php-cs-fixer.php',
					formatHtml: false,
					documentFormattingProvider: true,
					allowRisky: false,
					pathMode: 'override',
					ignorePHPVersion: false,
					exclude: [],
					tmpDir: '',
				}
				return configMap[key] ?? defaultValue
			})

			;(vscode.workspace.getConfiguration as any).mockImplementation((section: string) => {
				if (section === 'editor') {
					return {
						get: vi.fn((key, defaultValue) => {
							const editorConfig: Record<string, any> = {
								formatOnSave: false,
							}
							return editorConfig[key] ?? defaultValue
						}),
					}
				}
				if (section === 'php') {
					return {
						get: vi.fn((key, defaultValue) => {
							const phpConfig: Record<string, any> = {
								'validate.executablePath': 'php',
							}
							return phpConfig[key] ?? defaultValue
						}),
					}
				}
				return mockConfig
			})

			const pharFixer = new PHPCSFixer()
			expect(pharFixer.pharPath).toContain('php-cs-fixer.phar')
		})

		it('uses php from php.validate.executablePath for phar files', () => {
			mockConfig.get = vi.fn((key, defaultValue) => {
				const configMap: Record<string, any> = {
					onsave: false,
					autoFixByBracket: true,
					autoFixBySemicolon: false,
					executablePath: 'php /path/to/fixer.phar',
					executablePathWindows: '',
					rules: '@PSR12',
					config: '.php-cs-fixer.php',
					formatHtml: false,
					documentFormattingProvider: true,
					allowRisky: false,
					pathMode: 'override',
					ignorePHPVersion: false,
					exclude: [],
					tmpDir: '',
				}
				return configMap[key] ?? defaultValue
			})

			;(vscode.workspace.getConfiguration as any).mockImplementation((section: string) => {
				if (section === 'editor') {
					return {
						get: vi.fn((key, defaultValue) => {
							const editorConfig: Record<string, any> = {
								formatOnSave: false,
							}
							return editorConfig[key] ?? defaultValue
						}),
					}
				}
				if (section === 'php') {
					return {
						get: vi.fn((key, defaultValue) => {
							const phpConfig: Record<string, any> = {
								'validate.executablePath': '/usr/bin/php',
							}
							return phpConfig[key] ?? defaultValue
						}),
					}
				}
				return mockConfig
			})

			const pharFixer = new PHPCSFixer()
			expect(pharFixer.executablePath).toBe('/usr/bin/php')
		})
	})

	describe('Editor and html settings', () => {
		it('loads formatOnSave from editor configuration', () => {
			;(vscode.workspace.getConfiguration as any).mockImplementation((section: string) => {
				if (section === 'editor') {
					return {
						get: vi.fn((key, defaultValue) => {
							const editorConfig: Record<string, any> = {
								formatOnSave: true,
							}
							return editorConfig[key] ?? defaultValue
						}),
					}
				}
				if (section === 'php') {
					return {
						get: vi.fn((key, defaultValue) => {
							const phpConfig: Record<string, any> = {
								'validate.executablePath': '',
							}
							return phpConfig[key] ?? defaultValue
						}),
					}
				}
				return mockConfig
			})

			const editorFixer = new PHPCSFixer()
			expect(editorFixer.editorFormatOnSave).toBe(true)
		})

		it('defaults formatOnSave to false', () => {
			expect(phpCSFixer.editorFormatOnSave).toBe(false)
		})
	})

	describe('Custom exclude patterns', () => {
		it('loads exclude patterns array', () => {
			mockConfig.get = vi.fn((key, defaultValue) => {
				const configMap: Record<string, any> = {
					onsave: false,
					autoFixByBracket: true,
					autoFixBySemicolon: false,
					executablePath: 'php-cs-fixer',
					executablePathWindows: '',
					rules: '@PSR12',
					config: '.php-cs-fixer.php',
					formatHtml: false,
					documentFormattingProvider: true,
					allowRisky: false,
					pathMode: 'override',
					ignorePHPVersion: false,
					exclude: ['vendor/**', 'node_modules/**', 'tests/**'],
					tmpDir: '',
				}
				return configMap[key] ?? defaultValue
			})

			const excludeFixer = new PHPCSFixer()
			expect(excludeFixer.exclude).toEqual(['vendor/**', 'node_modules/**', 'tests/**'])
		})
	})
})
