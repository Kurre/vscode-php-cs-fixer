import fs from 'node:fs'
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

// Mock other modules
vi.mock('node:fs')
vi.mock('node:fs/promises')
vi.mock('anymatch')
vi.mock('./beautifyHtml')
vi.mock('./download-phar')
vi.mock('./output')
vi.mock('./runAsync')

import * as vscode from 'vscode'

import { activate, deactivate } from './extension'

describe('extension.ts - activate/deactivate', () => {
	let mockConfig: any

	beforeEach(() => {
		vi.clearAllMocks()

		// Setup fs mocks
		;(fs.writeFileSync as any).mockImplementation(() => undefined)
		;(fs.readFileSync as any).mockReturnValue('<?php echo "test"; ?>')
		;(fs.mkdirSync as any).mockImplementation(() => undefined)
		;(fs.existsSync as any).mockReturnValue(false)
		;(fs.rm as any).mockImplementation((_path: any, _options: any, callback: any) => {
			callback(null)
		})

		// Setup configuration mock
		mockConfig = {
			get: vi.fn((key, defaultValue) => {
				const configMap: Record<string, any> = {
					onsave: false,
					executablePath: 'php-cs-fixer',
					rules: '@PSR12',
					config: '.php-cs-fixer.php',
					formatHtml: false,
					allowRisky: false,
					exclude: [],
				}
				return configMap[key] ?? defaultValue
			}),
		}

		// Mock workspace.getConfiguration
		;(vscode.workspace.getConfiguration as any).mockReturnValue(mockConfig)
	})

	it('exports activate function', () => {
		expect(typeof activate).toBe('function')
	})

	it('exports deactivate function', () => {
		expect(typeof deactivate).toBe('function')
	})

	it('activate receives context parameter', async () => {
		const context = new (vscode as any).ExtensionContext()
		expect(context).toBeDefined()
		expect(context.subscriptions).toBeInstanceOf(Array)
	})

	it('activate calls workspace.getConfiguration', async () => {
		const context = new (vscode as any).ExtensionContext()
		activate(context)
		expect(vscode.workspace.getConfiguration).toHaveBeenCalled()
	})

	it('activate registers onWillSaveTextDocument', async () => {
		const context = new (vscode as any).ExtensionContext()
		activate(context)
		expect(vscode.workspace.onWillSaveTextDocument).toHaveBeenCalled()
	})

	it('activate registers onDidChangeTextDocument', async () => {
		const context = new (vscode as any).ExtensionContext()
		activate(context)
		expect(vscode.workspace.onDidChangeTextDocument).toHaveBeenCalled()
	})

	it('activate registers onDidChangeConfiguration', async () => {
		const context = new (vscode as any).ExtensionContext()
		activate(context)
		expect(vscode.workspace.onDidChangeConfiguration).toHaveBeenCalled()
	})

	it('activate registers commands', async () => {
		const context = new (vscode as any).ExtensionContext()
		activate(context)
		expect(vscode.commands.registerCommand).toHaveBeenCalled()
	})

	it('activate registers text editor commands', async () => {
		const context = new (vscode as any).ExtensionContext()
		activate(context)
		expect(vscode.commands.registerTextEditorCommand).toHaveBeenCalled()
	})

	it('activate registers document formatter provider when enabled', async () => {
		mockConfig.get = vi.fn((key, defaultValue) => {
			if (key === 'documentFormattingProvider') return true
			const configMap: Record<string, any> = {
				onsave: false,
				executablePath: 'php-cs-fixer',
				rules: '@PSR12',
				config: '.php-cs-fixer.php',
				formatHtml: false,
				allowRisky: false,
				exclude: [],
			}
			return configMap[key] ?? defaultValue
		})
		const context = new (vscode as any).ExtensionContext()
		activate(context)
		expect(vscode.languages.registerDocumentFormattingEditProvider).toHaveBeenCalled()
	})

	it('activate registers range formatter provider', async () => {
		const context = new (vscode as any).ExtensionContext()
		activate(context)
		expect(vscode.languages.registerDocumentRangeFormattingEditProvider).toHaveBeenCalled()
	})

	it('activate adds subscriptions to context', async () => {
		const context = new (vscode as any).ExtensionContext()
		activate(context)
		expect(context.subscriptions.length).toBeGreaterThan(0)
	})

	it('deactivate is callable', async () => {
		expect(() => deactivate()).not.toThrow()
	})

	it('deactivate does not throw errors', async () => {
		const result = deactivate()
		expect(result).toBeUndefined()
	})

	it('activate can be called multiple times', async () => {
		const context = new (vscode as any).ExtensionContext()
		expect(() => {
			activate(context)
			activate(context)
		}).not.toThrow()
	})
})
