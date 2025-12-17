import { vi } from 'vitest'

class ExtensionContext {
	subscriptions: any[] = []
}

export function createVscodeMock() {
	return {
		commands: {
			registerCommand: vi.fn((id, callback) => ({ dispose: () => {}, id, callback })),
			registerTextEditorCommand: vi.fn((id, callback) => ({ dispose: () => {}, id, callback })),
			executeCommand: vi.fn(() => Promise.resolve()),
		},
		languages: {
			registerDocumentFormattingEditProvider: vi.fn((selector, provider) => ({
				dispose: () => {},
				selector,
				provider,
			})),
			registerDocumentRangeFormattingEditProvider: vi.fn((selector, provider) => ({
				dispose: () => {},
				selector,
				provider,
			})),
		},
		workspace: {
			getConfiguration: vi.fn(),
			getWorkspaceFolder: vi.fn(),
			workspaceFolders: undefined,
			onWillSaveTextDocument: vi.fn((handler) => ({ dispose: () => {}, handler })),
			onDidChangeTextDocument: vi.fn((handler) => ({ dispose: () => {}, handler })),
			onDidChangeConfiguration: vi.fn((handler) => ({ dispose: () => {}, handler })),
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
}
