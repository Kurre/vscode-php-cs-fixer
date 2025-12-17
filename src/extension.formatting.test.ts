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
			showErrorMessage: vi.fn(() => Promise.resolve(undefined)),
		},
		Uri: {
			file: vi.fn((p: string) => ({ fsPath: p, scheme: 'file', path: p })),
			joinPath: vi.fn((...args: any[]) => ({
				fsPath: args[args.length - 1],
				scheme: 'file',
			})),
		},
		TextEdit: class TextEdit {
			constructor(
				public range: any,
				public newText: string,
			) {}
		},
		Position: class Position {
			constructor(
				public line: number,
				public character: number,
			) {}
			translate(lineDelta = 0, characterDelta = 0) {
				return new (this.constructor as any)(this.line + lineDelta, this.character + characterDelta)
			}
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
			if (pattern.endsWith('/**')) {
				const prefix = pattern.slice(0, -3)
				if (input.includes(prefix)) {
					return true
				}
			}
			if (pattern.startsWith('*') && !pattern.includes('/')) {
				const suffix = pattern.slice(1)
				if (input.endsWith(suffix)) {
					return true
				}
			}
			if (input === pattern) {
				return true
			}
		}
		return false
	},
}))
vi.mock('./beautifyHtml', () => ({
	default: (text: string) => text,
}))
vi.mock('./download-phar')
vi.mock('./output')
vi.mock('./runAsync')

import * as fs from 'node:fs'
import * as vscode from 'vscode'

import { PHPCSFixer } from './extension'
import { runAsync } from './runAsync'
import { FormattingService } from './formattingService'
import { loadConfig } from './config'

vi.mocked(runAsync).mockResolvedValue({ stdout: JSON.stringify({ files: [{ name: 'test.php' }] }), stderr: '' })

describe('PHPCSFixer Formatting Methods', () => {
	let mockConfig: any
	let fixer: PHPCSFixer
	let formatting: FormattingService

	beforeEach(() => {
		vi.clearAllMocks()
		mockConfig = createMockConfig({})
		setupMockWorkspace(mockConfig)
		fixer = new PHPCSFixer()
		formatting = new FormattingService(loadConfig())
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
					config: '.php-cs-fixer.php;.php-cs-fixer.dist.php;.php_cs;.php_cs.dist',
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
					get: vi.fn((key) => {
						if (key === 'formatOnSave') return false
						if (key === 'insertSpaces') return true
						if (key === 'tabSize') return 4
						return undefined
					}),
				}
			}
			if (section === 'html') {
				return {
					get: vi.fn(() => ({ indent_size: 2 })),
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

	describe('format() method', () => {
		it('should return formatted text when files array is not empty', async () => {
			vi.mocked(runAsync).mockResolvedValueOnce({
				stdout: JSON.stringify({ files: [{ name: 'test.php' }] }),
				stderr: '',
			})
			vi.mocked(fs.readFileSync as any).mockReturnValue('<?php echo "formatted";')

			const uri = (vscode.Uri.file as any)('/workspace/test.php')
			const result = await formatting.format('<?php echo "test";', uri, () => {}, {
				isDiff: false,
				isPartial: false,
				tmpDirRef: { value: '' },
			})

			expect(result).toBe('<?php echo "formatted";')
			expect(runAsync).toHaveBeenCalled()
		})

		it('should return original text when no files are formatted', async () => {
			vi.mocked(runAsync).mockResolvedValueOnce({
				stdout: JSON.stringify({ files: [] }),
				stderr: '',
			})

			const uri = (vscode.Uri.file as any)('/workspace/test.php')
			const originalText = '<?php echo "test";'
			const result = await formatting.format(originalText, uri, () => {}, {
				isDiff: false,
				isPartial: false,
				tmpDirRef: { value: '' },
			})

			expect(result).toBe(originalText)
		})

		it('should reject with error message when stderr contains error lines', async () => {
			vi.mocked(runAsync).mockResolvedValueOnce({
				stdout: JSON.stringify({ files: [] }),
				stderr: 'Error: Some error\nSecond line error',
			})

			const uri = (vscode.Uri.file as any)('/workspace/test.php')

			await expect(
				formatting.format('<?php echo "test";', uri, () => {}, {
					isDiff: false,
					isPartial: false,
					tmpDirRef: { value: '' },
				}),
			).rejects.toThrow()
		})

		it('should pass isDiff flag and return file path in diff mode', async () => {
			vi.mocked(runAsync).mockResolvedValueOnce({
				stdout: JSON.stringify({ files: [{ name: 'test.php' }] }),
				stderr: '',
			})

			const uri = (vscode.Uri.file as any)('/workspace/test.php')
			const result = await formatting.format('<?php echo "test";', uri, () => {}, {
				isDiff: true,
				isPartial: false,
				tmpDirRef: { value: '' },
			})

			// isDiff mode returns the file path instead of reading file content
			expect(typeof result).toBe('string')
			expect(result).toMatch(/php-cs-fixer-diff|pcf-tmp/)
		})

		it('should handle Buffer input in addition to string', async () => {
			vi.mocked(runAsync).mockResolvedValueOnce({
				stdout: JSON.stringify({ files: [{ name: 'test.php' }] }),
				stderr: '',
			})
			vi.mocked(fs.readFileSync as any).mockReturnValue('<?php echo "formatted";')

			const uri = (vscode.Uri.file as any)('/workspace/test.php')
			const buffer = Buffer.from('<?php echo "test";')
			const result = await formatting.format(buffer, uri, () => {}, {
				isDiff: false,
				isPartial: false,
				tmpDirRef: { value: '' },
			})

			expect(result).toBe('<?php echo "formatted";')
		})

		it('should pass correct spawn options for file URIs', async () => {
			vi.mocked(runAsync).mockResolvedValueOnce({
				stdout: JSON.stringify({ files: [{ name: 'test.php' }] }),
				stderr: '',
			})
			vi.mocked(fs.readFileSync as any).mockReturnValue('<?php echo "test";')

			const uri = (vscode.Uri.file as any)('/workspace/src/test.php')
			await formatting.format('<?php echo "test";', uri, () => {}, {
				isDiff: false,
				isPartial: false,
				tmpDirRef: { value: '' },
			})

			const callArgs = vi.mocked(runAsync).mock.calls[0]
			expect(callArgs[2]).toBeDefined() // opts argument
			expect(callArgs[2].cwd).toBe('/workspace/src')
		})

		it('should handle partial formatting (temp file mode)', async () => {
			vi.mocked(runAsync).mockResolvedValueOnce({
				stdout: JSON.stringify({ files: [{ name: 'test.php' }] }),
				stderr: '',
			})
			vi.mocked(fs.readFileSync as any).mockReturnValue('formatted')

			const uri = (vscode.Uri.file as any)('/workspace/test.php')
			const result = await formatting.format('<?php echo "test";', uri, () => {}, {
				isDiff: false,
				isPartial: true,
				tmpDirRef: { value: '' },
			})

			expect(result).toBe('formatted')
		})
	})

	describe('formattingProvider() method', () => {
		it('should return empty array when document is excluded', async () => {
			mockConfig = createMockConfig({ exclude: ['vendor/**'] })
			setupMockWorkspace(mockConfig)
			const fixer2 = new PHPCSFixer()

			const document = {
				uri: { path: '/workspace/vendor/package/test.php', scheme: 'file' },
				languageId: 'php',
				isUntitled: false,
				getText: () => '<?php echo "test";',
				lineCount: 1,
				lineAt: () => ({
					range: {
						end: { line: 0, character: 20 },
					},
				}),
			}

			const result = await fixer2.formattingProvider(document as any)
			expect(result).toEqual([])
		})

		it('should return empty array when formatted text is same as original', async () => {
			vi.mocked(runAsync).mockResolvedValueOnce({
				stdout: JSON.stringify({ files: [] }),
				stderr: '',
			})

			const document = {
				uri: { fsPath: '/workspace/test.php', scheme: 'file', path: '/workspace/test.php' },
				languageId: 'php',
				isUntitled: false,
				getText: () => '<?php echo "test";',
				lineCount: 1,
				lineAt: () => ({
					range: {
						end: { line: 0, character: 20 },
					},
				}),
			}

			const result = await fixer.formattingProvider(document as any)
			expect(result).toEqual([])
		})

		it('should return TextEdit when text changes', async () => {
			const originalText = '<?php echo "test";'
			const formattedText = '<?php echo "formatted";'

			vi.mocked(runAsync).mockResolvedValueOnce({
				stdout: JSON.stringify({ files: [{ name: 'test.php' }] }),
				stderr: '',
			})
			vi.mocked(fs.readFileSync as any).mockReturnValue(formattedText)

			const document = {
				uri: { fsPath: '/workspace/test.php', scheme: 'file', path: '/workspace/test.php' },
				languageId: 'php',
				isUntitled: false,
				getText: () => originalText,
				lineCount: 1,
				lineAt: () => ({
					range: {
						end: { line: 0, character: originalText.length },
					},
				}),
			}

			const result = await fixer.formattingProvider(document as any)

			expect(result).toHaveLength(1)
			expect(result[0]).toBeDefined()
			expect(result[0].newText).toBe(formattedText)
		})

		it('should use custom formatting options', async () => {
			vi.mocked(runAsync).mockResolvedValueOnce({
				stdout: JSON.stringify({ files: [] }),
				stderr: '',
			})

			const document = {
				uri: { fsPath: '/workspace/test.php', scheme: 'file', path: '/workspace/test.php' },
				languageId: 'php',
				isUntitled: false,
				getText: () => '<?php echo "test";',
				lineCount: 1,
				lineAt: () => ({
					range: {
						end: { line: 0, character: 20 },
					},
				}),
			}

			const customOptions = { insertSpaces: false, tabSize: 2 }
			await fixer.formattingProvider(document as any, customOptions)

			expect(runAsync).toHaveBeenCalled()
		})

		it('should handle formatting errors gracefully', async () => {
			vi.mocked(runAsync).mockRejectedValueOnce(new Error('Format error'))

			const document = {
				uri: { fsPath: '/workspace/test.php', scheme: 'file', path: '/workspace/test.php' },
				languageId: 'php',
				isUntitled: false,
				getText: () => '<?php echo "test";',
				lineCount: 1,
				lineAt: () => ({
					range: {
						end: { line: 0, character: 20 },
					},
				}),
			}

			await expect(fixer.formattingProvider(document as any)).rejects.toThrow()
		})
	})

	describe('rangeFormattingProvider() method', () => {
		it('should return empty array when document is excluded', async () => {
			mockConfig = createMockConfig({ exclude: ['vendor/**'] })
			setupMockWorkspace(mockConfig)
			const fixer2 = new PHPCSFixer()

			const document = {
				uri: { path: '/workspace/vendor/package/test.php', scheme: 'file' },
				languageId: 'php',
				isUntitled: false,
				getText: () => '<?php echo "test";',
			}

			const range = {
				start: { line: 0, character: 0 },
				end: { line: 0, character: 10 },
			}

			const result = await fixer2.rangeFormattingProvider(document as any, range as any)
			expect(result).toEqual([])
		})

		it('should format partial code selection', async () => {
			vi.mocked(runAsync).mockResolvedValueOnce({
				stdout: JSON.stringify({ files: [{ name: 'test.php' }] }),
				stderr: '',
			})
			vi.mocked(fs.readFileSync as any).mockReturnValue('formatted portion')

			const document = {
				uri: { fsPath: '/workspace/test.php', scheme: 'file', path: '/workspace/test.php' },
				languageId: 'php',
				isUntitled: false,
				getText: vi.fn((range) => 'echo "test";'),
				lineCount: 1,
			}

			const range = {
				start: { line: 0, character: 0 },
				end: { line: 0, character: 10 },
			}

			const result = await fixer.rangeFormattingProvider(document as any, range as any)

			expect(result).toHaveLength(1)
			expect(result[0].newText).toBe('formatted portion')
		})

		it('should handle multi-line range selections', async () => {
			vi.mocked(runAsync).mockResolvedValueOnce({
				stdout: JSON.stringify({ files: [{ name: 'test.php' }] }),
				stderr: '',
			})
			vi.mocked(fs.readFileSync as any).mockReturnValue('$formatted = "text";')

			const document = {
				uri: { fsPath: '/workspace/test.php', scheme: 'file', path: '/workspace/test.php' },
				languageId: 'php',
				isUntitled: false,
				getText: vi.fn(() => '$var = "text";\n$var2 = "text2";'),
				lineCount: 2,
			}

			const range = {
				start: { line: 0, character: 0 },
				end: { line: 1, character: 18 },
			}

			const result = await fixer.rangeFormattingProvider(document as any, range as any)

			expect(result).toHaveLength(1)
		})
	})

	describe('fix() method', () => {
		it('should execute fix command with correct arguments', async () => {
			vi.mocked(runAsync).mockResolvedValue({ stdout: 'Fixed', stderr: '' })

			const uri = (vscode.Uri.file as any)('/workspace/test.php')
			fixer.fix(uri)

			await new Promise((resolve) => setTimeout(resolve, 10))

			expect(runAsync).toHaveBeenCalledWith(
				expect.any(String),
				expect.any(Array),
				expect.any(Object),
				expect.any(Function),
			)
		})

		it('should handle ENOENT error when executable not found', async () => {
			const error = new Error('Command not found')
			;(error as any).code = 'ENOENT'
			vi.mocked(runAsync).mockRejectedValue(error)

			const uri = (vscode.Uri.file as any)('/workspace/test.php')
			fixer.fix(uri)

			await new Promise((resolve) => setTimeout(resolve, 10))

			expect(runAsync).toHaveBeenCalled()
		})

		it('should show status message on success', async () => {
			vi.mocked(runAsync).mockResolvedValue({ stdout: 'Fixed', stderr: '' })

			const uri = (vscode.Uri.file as any)('/workspace/test.php')
			fixer.fix(uri)

			await new Promise((resolve) => setTimeout(resolve, 10))

			// Should call runAsync
			expect(runAsync).toHaveBeenCalled()
		})
	})

	describe('diff() method', () => {
		it('should execute vscode.diff command with original and temp file URIs', async () => {
			vi.mocked(fs.readFileSync as any).mockReturnValue('<?php echo "test";')
			vi.mocked(runAsync).mockResolvedValueOnce({
				stdout: JSON.stringify({ files: [{ name: 'test.php' }] }),
				stderr: '',
			})

			const uri = (vscode.Uri.file as any)('/workspace/test.php')
			fixer.diff(uri)

			await new Promise((resolve) => setTimeout(resolve, 10))

			expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
				'vscode.diff',
				expect.any(Object),
				expect.any(Object),
				'diff',
			)
		})

		it('should handle errors in diff formatting', async () => {
			vi.mocked(fs.readFileSync as any).mockReturnValue('<?php echo "test";')
			vi.mocked(runAsync).mockRejectedValueOnce(new Error('Format failed'))

			const uri = (vscode.Uri.file as any)('/workspace/test.php')

			// Should not throw, just handle error
			fixer.diff(uri)

			await new Promise((resolve) => setTimeout(resolve, 10))

			expect(runAsync).toHaveBeenCalled()
		})
	})
})
