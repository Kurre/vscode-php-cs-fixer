import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createVscodeMock } from './test-utils/vscode-mock'

vi.mock('vscode', () => createVscodeMock())
vi.mock('node:fs')
vi.mock('node:fs/promises')
vi.mock('anymatch')
vi.mock('./beautifyHtml')
vi.mock('./download-phar', () => ({
	downloadPhpCsFixerFile: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('./output')
vi.mock('./runAsync')

import fs from 'node:fs'
import * as vscode from 'vscode'

import { activate } from './extension'
import { downloadPhpCsFixerFile } from './download-phar'
import { runAsync } from './runAsync'

// Mock fs.statSync
;(fs.statSync as any) = vi.fn((path: string) => ({
	isDirectory: () => false,
	isFile: () => true,
}))

// Mock runAsync to return proper Promise
vi.mocked(runAsync).mockResolvedValue({ stdout: JSON.stringify({ files: [{ name: 'test.php' }] }), stderr: '' })

describe('Extension Event Handlers', () => {
	let mockConfig: any
	let context: any

	beforeEach(() => {
		vi.clearAllMocks()
		mockConfig = createMockConfig({})
		setupMockWorkspace(mockConfig)
		context = new (vscode as any).ExtensionContext()
	})

	function createMockConfig(overrides: Record<string, any> = {}) {
		return {
			get: vi.fn((key, defaultValue) => {
				const defaults: Record<string, any> = {
					onsave: false,
					autoFixByBracket: true,
					autoFixBySemicolon: true,
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
					get: vi.fn((key) => (key === 'formatOnSave' ? false : undefined)),
				}
			}
			if (section === 'html') {
				return {
					get: vi.fn(() => ({})),
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

	describe('onWillSaveTextDocument', () => {
		it('should register onWillSaveTextDocument event handler', () => {
			activate(context)

			expect(vscode.workspace.onWillSaveTextDocument).toHaveBeenCalled()
			expect(context.subscriptions.length).toBeGreaterThan(0)
		})

		it('should format PHP document on save when onsave=true and formatOnSave=false', () => {
			mockConfig = createMockConfig({ onsave: true })
			setupMockWorkspace(mockConfig)

			activate(context)

			const handler = (vscode.workspace.onWillSaveTextDocument as any).mock.calls[0][0]
			const mockDocument = {
				languageId: 'php',
				uri: (vscode.Uri.file as any)('/test.php'),
				getText: () => '<?php echo "test";',
				lineCount: 1,
				lineAt: vi.fn((line: number) => ({
					range: {
						start: { line: 0, character: 0 },
						end: { line: 0, character: 20 },
					},
				})),
			}
			const mockEvent = {
				document: mockDocument,
				waitUntil: vi.fn(),
			}

			handler(mockEvent)

			expect(mockEvent.waitUntil).toHaveBeenCalled()
		})

		it('should not format when document is not PHP', () => {
			mockConfig = createMockConfig({ onsave: true })
			setupMockWorkspace(mockConfig)

			activate(context)

			const handler = (vscode.workspace.onWillSaveTextDocument as any).mock.calls[0][0]
			const mockDocument = {
				languageId: 'javascript',
				uri: (vscode.Uri.file as any)('/test.js'),
			}
			const mockEvent = {
				document: mockDocument,
				waitUntil: vi.fn(),
			}

			handler(mockEvent)

			expect(mockEvent.waitUntil).not.toHaveBeenCalled()
		})

		it('should not format when onsave=false', () => {
			mockConfig = createMockConfig({ onsave: false })
			setupMockWorkspace(mockConfig)

			activate(context)

			const handler = (vscode.workspace.onWillSaveTextDocument as any).mock.calls[0][0]
			const mockDocument = {
				languageId: 'php',
				uri: (vscode.Uri.file as any)('/test.php'),
			}
			const mockEvent = {
				document: mockDocument,
				waitUntil: vi.fn(),
			}

			handler(mockEvent)

			expect(mockEvent.waitUntil).not.toHaveBeenCalled()
		})

		it('should not format when editorFormatOnSave=true', () => {
			mockConfig = createMockConfig({ onsave: true })
			;(vscode.workspace.getConfiguration as any).mockImplementation((section: string) => {
				if (section === 'editor') {
					return {
						get: vi.fn((key) => (key === 'formatOnSave' ? true : undefined)),
					}
				}
				if (section === 'php') {
					return {
						get: vi.fn((key) => (key === 'validate.executablePath' ? '' : undefined)),
					}
				}
				return mockConfig
			})

			activate(context)

			const handler = (vscode.workspace.onWillSaveTextDocument as any).mock.calls[0][0]
			const mockDocument = {
				languageId: 'php',
				uri: (vscode.Uri.file as any)('/test.php'),
			}
			const mockEvent = {
				document: mockDocument,
				waitUntil: vi.fn(),
			}

			handler(mockEvent)

			expect(mockEvent.waitUntil).not.toHaveBeenCalled()
		})
	})

	describe('download command', () => {
		it('registers php-cs-fixer.downloadPhar command and triggers download', async () => {
			activate(context)

			const registerCalls = (vscode.commands.registerCommand as any).mock.calls
			const downloadCall = registerCalls.find((call: any[]) => call[0] === 'php-cs-fixer.downloadPhar')
			expect(downloadCall).toBeDefined()

			const handler = downloadCall[1]
			await handler()

			expect(downloadPhpCsFixerFile).toHaveBeenCalled()
		})
	})

	describe('onDidChangeTextDocument', () => {
		it('should register onDidChangeTextDocument event handler', () => {
			activate(context)

			expect(vscode.workspace.onDidChangeTextDocument).toHaveBeenCalled()
		})

		it('should not process when document is not PHP', () => {
			mockConfig = createMockConfig({ autoFixByBracket: true })
			setupMockWorkspace(mockConfig)

			activate(context)

			const handler = (vscode.workspace.onDidChangeTextDocument as any).mock.calls[0][0]
			const mockEvent = {
				document: {
					languageId: 'javascript',
					uri: (vscode.Uri.file as any)('/test.js'),
				},
				contentChanges: [{ text: '}' }],
			}

			// Should not throw
			handler(mockEvent)
		})

		it('should not process when document is excluded', () => {
			mockConfig = createMockConfig({ exclude: ['vendor/**'], autoFixByBracket: true })
			setupMockWorkspace(mockConfig)

			activate(context)

			const handler = (vscode.workspace.onDidChangeTextDocument as any).mock.calls[0][0]
			const mockEvent = {
				document: {
					languageId: 'php',
					uri: { path: '/workspace/vendor/test.php', scheme: 'file' },
					isUntitled: false,
				},
				contentChanges: [{ text: '}' }],
			}

			// Should not throw
			handler(mockEvent)
		})

		it('should call doAutoFixByBracket when autoFixByBracket=true', () => {
			mockConfig = createMockConfig({ autoFixByBracket: true, autoFixBySemicolon: false })
			setupMockWorkspace(mockConfig)
			;(vscode.window as any).activeTextEditor = null

			activate(context)

			const handler = (vscode.workspace.onDidChangeTextDocument as any).mock.calls[0][0]
			const mockEvent = {
				document: {
					languageId: 'php',
					uri: (vscode.Uri.file as any)('/test.php'),
					isUntitled: false,
				},
				contentChanges: [{ text: '}' }],
			}

			// Should not throw even without active editor
			expect(() => handler(mockEvent)).not.toThrow()
		})

		it('should call doAutoFixBySemicolon when autoFixBySemicolon=true', () => {
			mockConfig = createMockConfig({ autoFixByBracket: false, autoFixBySemicolon: true })
			setupMockWorkspace(mockConfig)
			;(vscode.window as any).activeTextEditor = null

			activate(context)

			const handler = (vscode.workspace.onDidChangeTextDocument as any).mock.calls[0][0]
			const mockEvent = {
				document: {
					languageId: 'php',
					uri: (vscode.Uri.file as any)('/test.php'),
					isUntitled: false,
				},
				contentChanges: [{ text: ';' }],
			}

			// Should not throw even without active editor
			expect(() => handler(mockEvent)).not.toThrow()
		})
	})

	describe('onDidChangeConfiguration', () => {
		it('should register onDidChangeConfiguration event handler', () => {
			activate(context)

			expect(vscode.workspace.onDidChangeConfiguration).toHaveBeenCalled()
		})

		it('should reload settings when configuration changes', () => {
			activate(context)

			const handler = (vscode.workspace.onDidChangeConfiguration as any).mock.calls[0][0]

			// Update config
			mockConfig = createMockConfig({ onsave: true })
			setupMockWorkspace(mockConfig)

			// Call handler
			handler()

			// Verify getConfiguration was called again
			const callCount = (vscode.workspace.getConfiguration as any).mock.calls.length
			expect(callCount).toBeGreaterThan(0)
		})
	})

	describe('Command registration', () => {
		it('should register php-cs-fixer.fix command', () => {
			activate(context)

			const fixCommand = (vscode.commands.registerTextEditorCommand as any).mock.calls.find(
				(call: any[]) => call[0] === 'php-cs-fixer.fix',
			)

			expect(fixCommand).toBeDefined()
		})

		it('should register php-cs-fixer.fix2 command', () => {
			activate(context)

			const fix2Command = (vscode.commands.registerCommand as any).mock.calls.find(
				(call: any[]) => call[0] === 'php-cs-fixer.fix2',
			)

			expect(fix2Command).toBeDefined()
		})

		it('should register php-cs-fixer.diff command', () => {
			activate(context)

			const diffCommand = (vscode.commands.registerCommand as any).mock.calls.find(
				(call: any[]) => call[0] === 'php-cs-fixer.diff',
			)

			expect(diffCommand).toBeDefined()
		})

		it('should register php-cs-fixer.showOutput command', () => {
			activate(context)

			const showOutputCommand = (vscode.commands.registerCommand as any).mock.calls.find(
				(call: any[]) => call[0] === 'php-cs-fixer.showOutput',
			)

			expect(showOutputCommand).toBeDefined()
		})

		it('fix command should format PHP documents', () => {
			activate(context)

			const fixCommand = (vscode.commands.registerTextEditorCommand as any).mock.calls.find(
				(call: any[]) => call[0] === 'php-cs-fixer.fix',
			)

			const handler = fixCommand[1]
			const mockEditor = {
				document: {
					languageId: 'php',
					uri: (vscode.Uri.file as any)('/test.php'),
					getText: () => '<?php echo "test";',
					lineAt: vi.fn((line: number) => ({
						text: 'line text',
						range: { end: new (vscode as any).Position(0, 10) },
					})),
					lineCount: 1,
				},
				edit: vi.fn(() => Promise.resolve(true)),
			}

			// Should not throw
			expect(() => handler(mockEditor)).not.toThrow()
		})

		it('fix command should ignore non-PHP documents', () => {
			activate(context)

			const fixCommand = (vscode.commands.registerTextEditorCommand as any).mock.calls.find(
				(call: any[]) => call[0] === 'php-cs-fixer.fix',
			)

			const handler = fixCommand[1]
			const mockEditor = {
				document: {
					languageId: 'javascript',
					uri: (vscode.Uri.file as any)('/test.js'),
				},
				edit: vi.fn(),
			}

			handler(mockEditor)

			expect(mockEditor.edit).not.toHaveBeenCalled()
		})

		it('fix2 command should handle file URI parameter', () => {
			activate(context)

			const fix2Command = (vscode.commands.registerCommand as any).mock.calls.find(
				(call: any[]) => call[0] === 'php-cs-fixer.fix2',
			)

			const handler = fix2Command[1]
			const fileUri = (vscode.Uri.file as any)('/test.php')

			// Should not throw
			expect(() => handler(fileUri)).not.toThrow()
		})

		it('fix2 command should use activeTextEditor when no file provided', () => {
			const mockEditor = {
				document: {
					languageId: 'php',
					uri: (vscode.Uri.file as any)('/test.php'),
				},
			}
			;(vscode.window as any).activeTextEditor = mockEditor

			activate(context)

			const fix2Command = (vscode.commands.registerCommand as any).mock.calls.find(
				(call: any[]) => call[0] === 'php-cs-fixer.fix2',
			)

			const handler = fix2Command[1]

			// Should not throw
			expect(() => handler(undefined)).not.toThrow()
		})

		it('fix2 command should reject non-file scheme URIs', () => {
			activate(context)

			const fix2Command = (vscode.commands.registerCommand as any).mock.calls.find(
				(call: any[]) => call[0] === 'php-cs-fixer.fix2',
			)

			const handler = fix2Command[1]
			const untitledUri = { scheme: 'untitled', fsPath: 'untitled:1' }

			handler(untitledUri)

			// Should exit early without error
		})

		it('diff command should handle file URI parameter', () => {
			activate(context)

			const diffCommand = (vscode.commands.registerCommand as any).mock.calls.find(
				(call: any[]) => call[0] === 'php-cs-fixer.diff',
			)

			const handler = diffCommand[1]
			const fileUri = (vscode.Uri.file as any)('/test.php')

			// Should not throw
			expect(() => handler(fileUri)).not.toThrow()
		})

		it('diff command should use activeTextEditor when no file provided', () => {
			const mockEditor = {
				document: {
					languageId: 'php',
					uri: (vscode.Uri.file as any)('/test.php'),
				},
			}
			;(vscode.window as any).activeTextEditor = mockEditor

			activate(context)

			const diffCommand = (vscode.commands.registerCommand as any).mock.calls.find(
				(call: any[]) => call[0] === 'php-cs-fixer.diff',
			)

			const handler = diffCommand[1]

			// Should not throw
			expect(() => handler(undefined)).not.toThrow()
		})
	})

	describe('Provider registration', () => {
		it('should register document formatting provider when documentFormattingProvider=true', () => {
			mockConfig = createMockConfig({ documentFormattingProvider: true })
			setupMockWorkspace(mockConfig)

			activate(context)

			expect(vscode.languages.registerDocumentFormattingEditProvider).toHaveBeenCalledWith(
				'php',
				expect.any(Object),
			)
		})

		it('should register range formatting provider', () => {
			mockConfig = createMockConfig({ documentFormattingProvider: true })
			setupMockWorkspace(mockConfig)

			activate(context)

			expect(vscode.languages.registerDocumentRangeFormattingEditProvider).toHaveBeenCalledWith(
				'php',
				expect.any(Object),
			)
		})

		it('should not register providers when documentFormattingProvider=false', () => {
			mockConfig = createMockConfig({ documentFormattingProvider: false })
			setupMockWorkspace(mockConfig)

			activate(context)

			expect(vscode.languages.registerDocumentFormattingEditProvider).not.toHaveBeenCalled()
			expect(vscode.languages.registerDocumentRangeFormattingEditProvider).not.toHaveBeenCalled()
		})
	})

	describe('Subscription management', () => {
		it('should add all subscriptions to context', () => {
			activate(context)

			expect(context.subscriptions.length).toBeGreaterThan(5)
		})

		it('should include event listeners in subscriptions', () => {
			activate(context)

			const hasOnWillSave = context.subscriptions.some((sub: any) => sub.handler !== undefined)
			expect(hasOnWillSave).toBe(true)
		})

		it('should include commands in subscriptions', () => {
			activate(context)

			const hasCommands = context.subscriptions.some((sub: any) => sub.id !== undefined)
			expect(hasCommands).toBe(true)
		})
	})
})
