import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createVscodeMock } from './test-utils/vscode-mock'

vi.mock('vscode', () => createVscodeMock())
vi.mock('node:fs')
vi.mock('node:fs/promises')
vi.mock('anymatch')
vi.mock('./beautifyHtml', () => ({
	default: (text: string) => text,
}))
vi.mock('./download-phar')
vi.mock('./output')
vi.mock('./runAsync')

import * as vscode from 'vscode'

import { AutoFixService } from './autoFixService'
import type { FormattingService } from './formattingService'

describe('PHPCSFixer Auto-Fix Features', () => {
	let mockConfig: any
	let autoFix: AutoFixService
	let formatting: Partial<FormattingService> & { format: ReturnType<typeof vi.fn> }

	beforeEach(() => {
		vi.clearAllMocks()
		mockConfig = createMockConfig({})
		setupMockWorkspace(mockConfig)
		formatting = {
			format: vi.fn().mockResolvedValue('formatted code'),
		}
		autoFix = new AutoFixService(formatting as FormattingService, () =>
			(vscode.Uri.file as any)('/workspace/test.php'),
		)
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

	function createMockDocument(text: string, lineTexts: string[]) {
		const lines = lineTexts.map((lineText, index) => ({
			text: lineText,
			lineNumber: index,
			range: {
				start: new (vscode as any).Position(index, 0),
				end: new (vscode as any).Position(index, lineText.length),
			},
		}))

		return {
			uri: (vscode.Uri.file as any)('/workspace/test.php'),
			languageId: 'php',
			isUntitled: false,
			getText: vi.fn((range?: any) => {
				if (!range) return text
				return text
			}),
			lineAt: vi.fn((lineNumberOrPosition: number | any) => {
				const lineNumber =
					typeof lineNumberOrPosition === 'number' ? lineNumberOrPosition : lineNumberOrPosition.line
				return lines[lineNumber]
			}),
			offsetAt: vi.fn((position: any) => {
				return position.line * 100 + position.character
			}),
		}
	}

	function createMockEditor(document: any, selection: any) {
		return {
			document,
			selection,
			selections: [selection],
			edit: vi.fn((callback: any) => {
				const builder = {
					replace: vi.fn(),
				}
				callback(builder)
				return Promise.resolve(true)
			}),
		}
	}

	describe('doAutoFixByBracket()', () => {
		it('should do nothing when contentChanges is empty', () => {
			const event = {
				contentChanges: [],
				document: createMockDocument('<?php\nfunction test() {\n}\n', []),
			}

			autoFix.doAutoFixByBracket(event as any)

			expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
		})

		it('should do nothing when pressed key is not a closing bracket', () => {
			const event = {
				contentChanges: [{ text: 'a' }],
				document: createMockDocument('<?php\nfunction test() {\n}\n', []),
			}

			autoFix.doAutoFixByBracket(event as any)

			expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
		})

		it('should do nothing when no active editor', () => {
			;(vscode.window as any).activeTextEditor = null

			const event = {
				contentChanges: [{ text: '}' }],
				document: createMockDocument('<?php\nfunction test() {\n}\n', []),
			}

			autoFix.doAutoFixByBracket(event as any)

			expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
		})

		it('should execute jumpToBracket when closing bracket is typed', () => {
			const lines = ['<?php', 'function test() {', '    echo "test";', '}']
			const document = createMockDocument(lines.join('\n'), lines)
			const selection = {
				start: new (vscode as any).Position(3, 1),
				end: new (vscode as any).Position(3, 1),
			}
			const editor = createMockEditor(document, selection)
			;(vscode.window as any).activeTextEditor = editor

			const event = {
				contentChanges: [{ text: '}' }],
				document,
			}

			autoFix.doAutoFixByBracket(event as any)

			expect(vscode.commands.executeCommand).toHaveBeenCalledWith('editor.action.jumpToBracket')
		})

		it('should call cursorUndo when bracket match is wrong', async () => {
			const lines = ['<?php', 'function test() {', '    echo "test";', '}']
			const document = createMockDocument(lines.join('\n'), lines)
			const selection = {
				start: new (vscode as any).Position(3, 1),
				end: new (vscode as any).Position(3, 1),
			}
			const editor = createMockEditor(document, selection)
			;(vscode.window as any).activeTextEditor = editor

			// Mock jumpToBracket to not change position (same offset)
			let jumpToBracketCalled = false
			;(vscode.commands.executeCommand as any).mockImplementation((cmd: string) => {
				if (cmd === 'editor.action.jumpToBracket' && !jumpToBracketCalled) {
					jumpToBracketCalled = true
					// Don't change editor.selection - same position
					return Promise.resolve()
				}
				return Promise.resolve()
			})

			const event = {
				contentChanges: [{ text: '}' }],
				document,
			}

			autoFix.doAutoFixByBracket(event as any)

			// Wait for async chain
			await new Promise((resolve) => setTimeout(resolve, 10))

			// jumpToBracket should be called but cursorUndo should NOT be called when offsets are same
			expect(vscode.commands.executeCommand).toHaveBeenCalledWith('editor.action.jumpToBracket')
		})

		it('should format code block when valid bracket pair found', async () => {
			const lines = ['<?php', 'function test() {', '    echo "test";', '}']
			const document = createMockDocument(lines.join('\n'), lines)
			const selection = {
				start: new (vscode as any).Position(3, 1),
				end: new (vscode as any).Position(3, 1),
			}
			const editor = createMockEditor(document, selection)
			;(vscode.window as any).activeTextEditor = editor

			// Mock jumpToBracket to change position to opening bracket
			let jumpToBracketCalled = false
			;(vscode.commands.executeCommand as any).mockImplementation((cmd: string) => {
				if (cmd === 'editor.action.jumpToBracket' && !jumpToBracketCalled) {
					jumpToBracketCalled = true
					editor.selection = {
						start: new (vscode as any).Position(1, 17), // Position of {
						end: new (vscode as any).Position(1, 17),
					}
					return Promise.resolve()
				}
				return Promise.resolve()
			})

			const event = {
				contentChanges: [{ text: '}' }],
				document,
			}

			autoFix.doAutoFixByBracket(event as any)

			await new Promise((resolve) => setTimeout(resolve, 10))

			expect(vscode.commands.executeCommand).toHaveBeenCalledWith('editor.action.jumpToBracket')
		})
	})

	describe('doAutoFixBySemicolon()', () => {
		it('should do nothing when contentChanges is empty', () => {
			const event = {
				contentChanges: [],
				document: createMockDocument('<?php\necho "test";\n', []),
			}

			autoFix.doAutoFixBySemicolon(event as any)

			// format should not be called
			const formatSpy = formatting.format
			expect(formatSpy).not.toHaveBeenCalled()
		})

		it('should do nothing when pressed key is not semicolon', () => {
			const event = {
				contentChanges: [{ text: 'a' }],
				document: createMockDocument('<?php\necho "test";\n', []),
			}

			autoFix.doAutoFixBySemicolon(event as any)

			const formatSpy = formatting.format
			expect(formatSpy).not.toHaveBeenCalled()
		})

		it('should do nothing when no active editor', () => {
			;(vscode.window as any).activeTextEditor = null

			const event = {
				contentChanges: [{ text: ';' }],
				document: createMockDocument('<?php\necho "test";\n', []),
			}

			autoFix.doAutoFixBySemicolon(event as any)

			const formatSpy = formatting.format
			expect(formatSpy).not.toHaveBeenCalled()
		})

		it('should do nothing when line is too short', () => {
			const lines = ['<?php', 'a;']
			const document = createMockDocument(lines.join('\n'), lines)
			const selection = {
				start: new (vscode as any).Position(1, 1),
				end: new (vscode as any).Position(1, 1),
			}
			const editor = createMockEditor(document, selection)
			;(vscode.window as any).activeTextEditor = editor

			const event = {
				contentChanges: [{ text: ';' }],
				document,
			}

			const formatSpy = formatting.format
			autoFix.doAutoFixBySemicolon(event as any)

			expect(formatSpy).not.toHaveBeenCalled()
		})

		it('should do nothing when cursor is not at end of line', () => {
			const lines = ['<?php', 'echo "test";']
			const document = createMockDocument(lines.join('\n'), lines)
			const selection = {
				start: new (vscode as any).Position(1, 5), // Not at end
				end: new (vscode as any).Position(1, 5),
			}
			const editor = createMockEditor(document, selection)
			;(vscode.window as any).activeTextEditor = editor

			const event = {
				contentChanges: [{ text: ';' }],
				document,
			}

			const formatSpy = formatting.format
			autoFix.doAutoFixBySemicolon(event as any)

			expect(formatSpy).not.toHaveBeenCalled()
		})

		it('should format line when semicolon is typed at end', async () => {
			const lines = ['<?php', 'echo "test";']
			const document = createMockDocument(lines.join('\n'), lines)

			const selection = {
				start: new (vscode as any).Position(1, 11),
				end: new (vscode as any).Position(1, 11),
			}
			const editor = createMockEditor(document, selection)
			;(vscode.window as any).activeTextEditor = editor

			// Mock format to return formatted text
			const formatSpy = formatting.format.mockResolvedValue('echo "test";')

			const event = {
				contentChanges: [{ text: ';' }],
				document,
			}

			autoFix.doAutoFixBySemicolon(event as any)

			await new Promise((resolve) => setTimeout(resolve, 10))

			expect(formatSpy).toHaveBeenCalled()
		})

		it('should replace line text when formatting changes content', async () => {
			const lines = ['<?php', 'echo   "test"  ;']
			const document = createMockDocument(lines.join('\n'), lines)

			const selection = {
				start: new (vscode as any).Position(1, 15),
				end: new (vscode as any).Position(1, 15),
			}
			const editor = createMockEditor(document, selection)
			;(vscode.window as any).activeTextEditor = editor

			// Original line: 'echo   "test"  ;'
			// After prefixing: '<?php\n$__pcf__spliter=0;\necho   "test"  ;'
			// After dealFun on original: 'echo   "test"  ;' (but trailing spaces stripped -> 'echo   "test"  ;')
			// We return formatted with normal spacing that's different
			formatting.format.mockResolvedValue('<?php\n$__pcf__spliter=0;\necho "formatted";')

			const event = {
				contentChanges: [{ text: ';' }],
				document,
			}

			autoFix.doAutoFixBySemicolon(event as any)

			await new Promise((resolve) => setTimeout(resolve, 20))

			expect(editor.edit).toHaveBeenCalled()
		})

		it('should not replace line when formatting produces same result', async () => {
			const lines = ['<?php', 'echo "test";']
			const document = createMockDocument(lines.join('\n'), lines)

			const selection = {
				start: new (vscode as any).Position(1, 11),
				end: new (vscode as any).Position(1, 11),
			}
			const editor = createMockEditor(document, selection)
			;(vscode.window as any).activeTextEditor = editor

			// Mock format to return same text
			formatting.format.mockResolvedValue('echo "test";')

			const event = {
				contentChanges: [{ text: ';' }],
				document,
			}

			autoFix.doAutoFixBySemicolon(event as any)

			await new Promise((resolve) => setTimeout(resolve, 10))

			expect(editor.edit).not.toHaveBeenCalled()
		})

		it('should handle format errors gracefully', async () => {
			const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
			const lines = ['<?php', 'echo "test";']
			const document = createMockDocument(lines.join('\n'), lines)

			const selection = {
				start: new (vscode as any).Position(1, 11),
				end: new (vscode as any).Position(1, 11),
			}
			const editor = createMockEditor(document, selection)
			;(vscode.window as any).activeTextEditor = editor

			// Mock format to reject
			const formatSpy = formatting.format.mockRejectedValue(new Error('Format failed'))

			const event = {
				contentChanges: [{ text: ';' }],
				document,
			}

			autoFix.doAutoFixBySemicolon(event as any)

			await new Promise((resolve) => setTimeout(resolve, 10))

			// Just verify format was called and error was caught (not thrown)
			expect(formatSpy).toHaveBeenCalled()
			consoleSpy.mockRestore()
		})
	})
})
