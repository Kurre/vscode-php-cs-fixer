import os from 'node:os'
import path from 'node:path'
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

describe('PHPCSFixer.resolveVscodeExpressions()', () => {
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

		phpCSFixer = new PHPCSFixer()
	})

	describe('${extensionPath} expansion', () => {
		it('expands ${extensionPath} to __dirname', () => {
			const result = phpCSFixer.resolveVscodeExpressions('${extensionPath}/php-cs-fixer.phar')
			expect(result).not.toContain('${extensionPath}')
			expect(result).toContain('php-cs-fixer.phar')
		})

		it('handles ${extensionPath} at start of path', () => {
			const input = '${extensionPath}/bin/fixer'
			const result = phpCSFixer.resolveVscodeExpressions(input)
			expect(result).not.toContain('${extensionPath}')
		})

		it('leaves unknown expressions unchanged', () => {
			const input = '${unknownPath}/file.php'
			const result = phpCSFixer.resolveVscodeExpressions(input)
			expect(result).toBe(input)
		})
	})

	describe('~ (home directory) expansion', () => {
		it('expands ~ to home directory', () => {
			const input = '~/php-cs-fixer.phar'
			const result = phpCSFixer.resolveVscodeExpressions(input)
			const homeDir = os.homedir()
			expect(result).toBe(path.join(homeDir, 'php-cs-fixer.phar'))
		})

		it('expands ~/ to home directory with slash', () => {
			const input = '~/.config/php-cs-fixer'
			const result = phpCSFixer.resolveVscodeExpressions(input)
			const homeDir = os.homedir()
			expect(result).toContain(homeDir)
		})

		it('handles tilde not at start as literal', () => {
			const input = '/path/to/~file.php'
			const result = phpCSFixer.resolveVscodeExpressions(input)
			expect(result).toBe(input)
		})

		it('does not expand tilde without slash following', () => {
			const input = '~file.php'
			const result = phpCSFixer.resolveVscodeExpressions(input)
			expect(result).toBe(input)
		})
	})

	describe('${workspaceFolder} expansion', () => {
		it('expands ${workspaceFolder} when context uri provided', () => {
			;(vscode.workspace.getWorkspaceFolder as any).mockReturnValue({
				uri: { scheme: 'file', fsPath: '/workspace/root' },
			})

			const uri = { fsPath: '/workspace/root/file.php', scheme: 'file' }
			const result = phpCSFixer.resolveVscodeExpressions('${workspaceFolder}/config.php', { uri })

			expect(result).toContain('config.php')
			expect(result).not.toContain('${workspaceFolder}')
		})

		it('expands ${workspaceRoot} (deprecated) when context uri provided', () => {
			;(vscode.workspace.getWorkspaceFolder as any).mockReturnValue({
				uri: { scheme: 'file', fsPath: '/workspace/root' },
			})

			const uri = { fsPath: '/workspace/root/file.php', scheme: 'file' }
			const result = phpCSFixer.resolveVscodeExpressions('${workspaceRoot}/config.php', { uri })

			expect(result).toContain('config.php')
			expect(result).not.toContain('${workspaceRoot}')
		})

		it('leaves workspace expressions unchanged if no uri context', () => {
			const input = '${workspaceFolder}/file.php'
			const result = phpCSFixer.resolveVscodeExpressions(input, {})
			expect(result).toBe(input)
		})

		it('handles non-file scheme URIs gracefully', () => {
			;(vscode.workspace.getWorkspaceFolder as any).mockReturnValue({
				uri: { scheme: 'file', fsPath: '/workspace/root' },
			})

			const uri = { fsPath: 'file:///untitled:1', scheme: 'untitled' }
			const input = '${workspaceFolder}/config.php'
			const result = phpCSFixer.resolveVscodeExpressions(input, { uri })
			// Non-file schemes still get expanded if workspace folder is found
			expect(result).not.toContain('${workspaceFolder}')
		})
	})

	describe('getActiveWorkspaceFolder()', () => {
		it('returns workspace folder containing uri', () => {
			const workspaceFolder = { uri: { scheme: 'file', fsPath: '/workspace' } }
			;(vscode.workspace.getWorkspaceFolder as any).mockReturnValue(workspaceFolder)

			const uri = { fsPath: '/workspace/file.php', scheme: 'file' }
			const result = phpCSFixer.getActiveWorkspaceFolder(uri)

			expect(result).toEqual(workspaceFolder)
		})

		it('falls back to single workspace folder', () => {
			const workspaceFolder = { uri: { scheme: 'file', fsPath: '/workspace' } }
			;(vscode.workspace.getWorkspaceFolder as any).mockReturnValue(undefined)
			;(vscode.workspace as any).workspaceFolders = [workspaceFolder]

			const uri = { fsPath: '/workspace/file.php', scheme: 'file' }
			const result = phpCSFixer.getActiveWorkspaceFolder(uri)

			expect(result).toEqual(workspaceFolder)
		})

		it('returns undefined for multi-root without matching folder', () => {
			;(vscode.workspace.getWorkspaceFolder as any).mockReturnValue(undefined)
			;(vscode.workspace as any).workspaceFolders = [
				{ uri: { scheme: 'file', fsPath: '/workspace1' } },
				{ uri: { scheme: 'file', fsPath: '/workspace2' } },
			]

			const uri = { fsPath: '/workspace3/file.php', scheme: 'file' }
			const result = phpCSFixer.getActiveWorkspaceFolder(uri)

			expect(result).toBeUndefined()
		})

		it('returns undefined when no workspace folders', () => {
			;(vscode.workspace.getWorkspaceFolder as any).mockReturnValue(undefined)
			;(vscode.workspace as any).workspaceFolders = undefined

			const uri = { fsPath: '/file.php', scheme: 'file' }
			const result = phpCSFixer.getActiveWorkspaceFolder(uri)

			expect(result).toBeUndefined()
		})

		it('handles empty workspace folders array', () => {
			;(vscode.workspace.getWorkspaceFolder as any).mockReturnValue(undefined)
			;(vscode.workspace as any).workspaceFolders = []

			const uri = { fsPath: '/file.php', scheme: 'file' }
			const result = phpCSFixer.getActiveWorkspaceFolder(uri)

			expect(result).toBeUndefined()
		})
	})

	describe('Path normalization', () => {
		it('normalizes paths correctly', () => {
			const result = phpCSFixer.resolveVscodeExpressions('/path/to/file.php')
			expect(result).toBe(path.normalize('/path/to/file.php'))
		})

		it('handles Windows-style paths', () => {
			const input = 'C:\\Users\\test\\file.php'
			const result = phpCSFixer.resolveVscodeExpressions(input)
			expect(typeof result).toBe('string')
			expect(result.length).toBeGreaterThan(0)
		})

		it('normalizes paths with double slashes', () => {
			const input = '/path//to///file.php'
			const result = phpCSFixer.resolveVscodeExpressions(input)
			expect(result).not.toContain('//')
		})
	})

	describe('getRealExecutablePath()', () => {
		it('resolves executable path with context', () => {
			mockConfig.get = vi.fn((key, defaultValue) => {
				const configMap: Record<string, any> = {
					onsave: false,
					autoFixByBracket: true,
					autoFixBySemicolon: false,
					executablePath: '${extensionPath}/php-cs-fixer.phar',
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

			const fixer = new PHPCSFixer()
			const uri = { fsPath: '/workspace/file.php', scheme: 'file' }
			const result = fixer.getRealExecutablePath(uri)

			expect(typeof result).toBe('string')
			expect(result.length).toBeGreaterThan(0)
		})
	})

	describe('Complex scenarios', () => {
		it('handles combination of expansions', () => {
			const input = '${extensionPath}/vendor/bin/fixer'
			const result = phpCSFixer.resolveVscodeExpressions(input)
			expect(result).not.toContain('${extensionPath}')
		})

		it('preserves relative paths', () => {
			const input = './vendor/bin/php-cs-fixer'
			const result = phpCSFixer.resolveVscodeExpressions(input)
			expect(result).toContain('vendor')
		})

		it('handles empty string', () => {
			const result = phpCSFixer.resolveVscodeExpressions('')
			// path.normalize('') returns '.'
			expect(result).toBe('.')
		})

		it('handles paths with spaces', () => {
			const input = '/path/with spaces/php-cs-fixer'
			const result = phpCSFixer.resolveVscodeExpressions(input)
			expect(result).toContain('spaces')
		})
	})
})
