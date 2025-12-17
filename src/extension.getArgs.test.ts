import fs from 'node:fs'
import os from 'node:os'
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
vi.mock('anymatch')
vi.mock('./beautifyHtml')
vi.mock('./download-phar')
vi.mock('./output')
vi.mock('./runAsync')

import * as vscode from 'vscode'

import { PHPCSFixer } from './extension'

describe('PHPCSFixer.getArgs()', () => {
	let phpCSFixer: PHPCSFixer
	let mockConfig: any

	beforeEach(() => {
		vi.clearAllMocks()

		mockConfig = {
			get: vi.fn((key, defaultValue) => {
				const configMap: Record<string, any> = {
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
				}
				return configMap[key] ?? defaultValue
			}),
		}

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

		;(vscode.workspace.getWorkspaceFolder as any).mockReturnValue(undefined)
		;(vscode.workspace as any).workspaceFolders = undefined

		phpCSFixer = new PHPCSFixer()
	})

	describe('Basic argument structure', () => {
		it('includes fix command', () => {
			const uri = { fsPath: '/workspace/test.php', scheme: 'file' }
			const args = phpCSFixer.getArgs(uri)
			expect(args).toContain('fix')
		})

		it('includes --using-cache=no flag', () => {
			const uri = { fsPath: '/workspace/test.php', scheme: 'file' }
			const args = phpCSFixer.getArgs(uri)
			expect(args).toContain('--using-cache=no')
		})

		it('includes --format=json flag', () => {
			const uri = { fsPath: '/workspace/test.php', scheme: 'file' }
			const args = phpCSFixer.getArgs(uri)
			expect(args).toContain('--format=json')
		})

		it('includes file path as last argument', () => {
			const uri = { fsPath: '/workspace/test.php', scheme: 'file' }
			const args = phpCSFixer.getArgs(uri)
			expect(args[args.length - 1]).toBe('/workspace/test.php')
		})
	})

	describe('Path mode handling', () => {
		it('uses path-mode=override for real files by default', () => {
			mockConfig.get = vi.fn((key, defaultValue) => {
				const configMap: Record<string, any> = {
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
								'validate.executablePath': '',
							}
							return phpConfig[key] ?? defaultValue
						}),
					}
				}
				return mockConfig
			})

			const fixer = new PHPCSFixer()
			const uri = { fsPath: '/workspace/test.php', scheme: 'file' }
			const args = fixer.getArgs(uri)
			expect(args).toContain('--path-mode=override')
		})

		it('forces path-mode=override for temp files', () => {
			const tempDir = os.tmpdir()
			const tempPath = `${tempDir}/test.php`
			const uri = { fsPath: tempPath, scheme: 'file' }
			const args = phpCSFixer.getArgs(uri)
			expect(args).toContain('--path-mode=override')
		})

		it('uses configured pathMode for non-temp files', () => {
			mockConfig.get = vi.fn((key, defaultValue) => {
				const configMap: Record<string, any> = {
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
					pathMode: 'pathMode',
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
								'validate.executablePath': '',
							}
							return phpConfig[key] ?? defaultValue
						}),
					}
				}
				return mockConfig
			})

			const fixer = new PHPCSFixer()
			const uri = { fsPath: '/workspace/test.php', scheme: 'file' }
			const args = fixer.getArgs(uri)
			expect(args).toContain('--path-mode=pathMode')
		})
	})

	describe('Rules configuration', () => {
		it('adds rules when config not found', () => {
			mockConfig.get = vi.fn((key, defaultValue) => {
				const configMap: Record<string, any> = {
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
								'validate.executablePath': '',
							}
							return phpConfig[key] ?? defaultValue
						}),
					}
				}
				return mockConfig
			})

			const fixer = new PHPCSFixer()
			const uri = { fsPath: '/workspace/test.php', scheme: 'file' }
			const args = fixer.getArgs(uri)
			expect(args).toContain('--rules=@PSR12')
		})

		it('does not add rules when config is found', () => {
			;(fs.existsSync as any).mockReturnValue(true)

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
								'validate.executablePath': '',
							}
							return phpConfig[key] ?? defaultValue
						}),
					}
				}
				return mockConfig
			})

			;(vscode.workspace.getWorkspaceFolder as any).mockReturnValue({
				uri: { scheme: 'file', fsPath: '/workspace' },
			})

			const fixer = new PHPCSFixer()
			const uri = { fsPath: '/workspace/test.php', scheme: 'file' }
			const args = fixer.getArgs(uri)
			// When config file exists, it should have --config= but not --rules=
			expect(args.some((arg) => arg.includes('--rules='))).toBe(false)
			expect(args.some((arg) => arg.includes('--config='))).toBe(true)
		})
	})

	describe('Allow risky flag', () => {
		it('adds --allow-risky=yes when enabled', () => {
			mockConfig.get = vi.fn((key, defaultValue) => {
				const configMap: Record<string, any> = {
					onsave: false,
					autoFixByBracket: true,
					autoFixBySemicolon: false,
					executablePath: 'php-cs-fixer',
					executablePathWindows: '',
					rules: '@PSR12',
					config: '',
					formatHtml: false,
					documentFormattingProvider: true,
					allowRisky: true,
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
								'validate.executablePath': '',
							}
							return phpConfig[key] ?? defaultValue
						}),
					}
				}
				return mockConfig
			})

			const fixer = new PHPCSFixer()
			const uri = { fsPath: '/workspace/test.php', scheme: 'file' }
			const args = fixer.getArgs(uri)
			expect(args).toContain('--allow-risky=yes')
		})

		it('does not add allow-risky flag when disabled', () => {
			const uri = { fsPath: '/workspace/test.php', scheme: 'file' }
			const args = phpCSFixer.getArgs(uri)
			expect(args.some((arg) => arg.includes('--allow-risky'))).toBe(false)
		})
	})

	describe('.phar file handling', () => {
		it('prepends phar path when configured', () => {
			mockConfig.get = vi.fn((key, defaultValue) => {
				const configMap: Record<string, any> = {
					onsave: false,
					autoFixByBracket: true,
					autoFixBySemicolon: false,
					executablePath: 'php /path/to/fixer.phar',
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
								'validate.executablePath': '',
							}
							return phpConfig[key] ?? defaultValue
						}),
					}
				}
				return mockConfig
			})

			const fixer = new PHPCSFixer()
			const uri = { fsPath: '/workspace/test.php', scheme: 'file' }
			const args = fixer.getArgs(uri)
			expect(args[0]).toContain('fixer.phar')
		})
	})

	describe('Custom file path', () => {
		it('uses provided filePath instead of uri.fsPath', () => {
			const uri = { fsPath: '/workspace/test.php', scheme: 'file' }
			const customPath = '/custom/path/file.php'
			const args = phpCSFixer.getArgs(uri, customPath)
			expect(args[args.length - 1]).toBe(customPath)
		})
	})

	describe('Windows path quoting', () => {
		it('quotes paths with spaces on Windows', () => {
			const originalPlatform = process.platform
			Object.defineProperty(process, 'platform', {
				value: 'win32',
				configurable: true,
			})

			mockConfig.get = vi.fn((key, defaultValue) => {
				const configMap: Record<string, any> = {
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
								'validate.executablePath': '',
							}
							return phpConfig[key] ?? defaultValue
						}),
					}
				}
				return mockConfig
			})

			const fixer = new PHPCSFixer()
			const uri = { fsPath: 'C:\\Program Files\\test.php', scheme: 'file' }
			const args = fixer.getArgs(uri)

			// Check that the last argument (file path) is the one we passed
			expect(args[args.length - 1]).toBe('C:\\Program Files\\test.php')

			Object.defineProperty(process, 'platform', {
				value: originalPlatform,
				configurable: true,
			})
		})
	})
})
