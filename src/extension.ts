import fs from 'node:fs'
import path from 'node:path'
import anymatch from 'anymatch'
import {
	commands,
	type ExtensionContext,
	type FormattingOptions,
	languages,
	Position,
	Range,
	type TextDocument,
	type TextDocumentChangeEvent,
	TextEdit,
	Uri,
	window,
	workspace,
} from 'vscode'

import { beautify } from './beautifyHtml'
import { downloadPhpCsFixerFile } from './download-phar'
import { clearOutput, disposeOutput, hideStatusBar, output, showOutput, statusInfo } from './output'
import { AutoFixService } from './autoFixService'
import { FormattingService } from './formattingService'
import { loadConfig } from './config'
import { runAsync } from './runAsync'
import { buildSpawnOptions } from './spawnHelpers'

export class PHPCSFixer {
	onsave = false
	autoFixByBracket = false
	autoFixBySemicolon = false
	executablePath = ''
	rules: string | Record<string, boolean | string> = ''
	config = ''
	formatHtml = false
	documentFormattingProvider = false
	allowRisky = false
	pathMode: 'pathMode' | 'override' = 'override'
	ignorePHPVersion = false
	exclude: string[] = []
	pharPath = ''
	editorFormatOnSave = false
	tmpDir = ''

	private _config = loadConfig()
	private formatting = new FormattingService(this._config)
	private autoFix = new AutoFixService(this.formatting, () => this.lastDocumentUri)
	private lastDocumentUri: Uri = Uri.file('')

	constructor() {
		this.applyConfig()
		this.checkUpdate()
	}

	private applyConfig() {
		this.onsave = this._config.onsave
		this.autoFixByBracket = this._config.autoFixByBracket
		this.autoFixBySemicolon = this._config.autoFixBySemicolon
		this.executablePath = this._config.executablePath
		this.rules = this._config.rules
		this.config = this._config.config
		this.formatHtml = this._config.formatHtml
		this.documentFormattingProvider = this._config.documentFormattingProvider
		this.allowRisky = this._config.allowRisky
		this.pathMode = this._config.pathMode
		this.ignorePHPVersion = this._config.ignorePHPVersion
		this.exclude = this._config.exclude
		this.pharPath = this._config.pharPath
		this.tmpDir = this._config.tmpDir
		this.editorFormatOnSave = this._config.editorFormatOnSave
	}

	loadSettings() {
		this._config = loadConfig()
		this.applyConfig()
		this.formatting = new FormattingService(this._config)
		this.autoFix = new AutoFixService(this.formatting, () => this.lastDocumentUri)
	}

	formattingProvider(
		document: TextDocument,
		options: FormattingOptions = { insertSpaces: true, tabSize: 4 },
	): Promise<TextEdit[]> {
		if (this.isExcluded(document)) {
			return Promise.resolve([])
		}

		// only activeTextEditor, or last activeTextEditor
		// if (window.activeTextEditor === undefined
		//     || (window.activeTextEditor.document.uri.toString() !== document.uri.toString() && lastActiveEditor !== document.uri.toString()))
		//     return

		return new Promise((resolve, reject) => {
			this.lastDocumentUri = document.uri
			const originalText = document.getText()
			const lastLine = document.lineAt(document.lineCount - 1)
			const range = new Range(new Position(0, 0), lastLine.range.end)

			const htmlFormatConfig = workspace.getConfiguration('html').get('format')
			if (typeof htmlFormatConfig !== 'object' || htmlFormatConfig === null) {
				return Promise.reject()
			}
			const htmlOptions = { ...options, ...htmlFormatConfig }

			const originalText2 = this.formatHtml ? beautify(originalText, htmlOptions) : originalText

			const tmpDirRef = { value: this.tmpDir }
			this.formatting
				.format(originalText2, document.uri, () => this.errorTip(), {
					isDiff: false,
					isPartial: false,
					tmpDirRef,
				})
				.then((text) => {
					if (text && text !== originalText) {
						resolve([new TextEdit(range, text)])
					} else {
						resolve([])
					}
				})
				.catch((err) => {
					console.log(err)
					reject(err)
				})
		})
	}

	rangeFormattingProvider(document: TextDocument, range: Range): Promise<TextEdit[]> {
		if (this.isExcluded(document)) {
			return Promise.resolve([])
		}

		// only activeTextEditor, or last activeTextEditor
		// if (window.activeTextEditor === undefined
		//     || (window.activeTextEditor.document.uri.toString() !== document.uri.toString() && lastActiveEditor !== document.uri.toString()))
		//     return

		return new Promise((resolve, reject) => {
			this.lastDocumentUri = document.uri
			let originalText = document.getText(range)
			if (originalText.replace(/\s+/g, '').length === 0) {
				reject()
				return
			}
			let addPHPTag = false
			if (originalText.search(/^\s*<\?php/i) === -1) {
				originalText = `<?php\n${originalText}`
				addPHPTag = true
			}

			const tmpDirRef = { value: this.tmpDir }
			this.formatting
				.format(originalText, document.uri, () => this.errorTip(), {
					isDiff: false,
					isPartial: false,
					tmpDirRef,
				})
				.then((text) => {
					let fixedText = text
					if (addPHPTag) {
						fixedText = fixedText.replace(/^<\?php\r?\n/, '')
					}
					if (fixedText && fixedText !== originalText) {
						resolve([new TextEdit(range, fixedText)])
					} else {
						resolve([])
					}
				})
				.catch((err) => {
					console.log(err)
					reject()
				})
		})
	}

	fix(uri: Uri) {
		clearOutput()
		statusInfo('fixing')

		const args = this.formatting.getArgs(uri)
		const opts = buildSpawnOptions(uri, this.ignorePHPVersion)

		const realExecutablePath = this.formatting.getRealExecutablePath(uri)
		if (!realExecutablePath) {
			this.errorTip()
			return
		}

		runAsync(realExecutablePath, args, opts, (data) => {
			output(data.toString())
		})
			.then(() => {
				hideStatusBar()
			})
			.catch((err: any) => {
				statusInfo('failed')
				if (err.code === 'ENOENT') {
					this.errorTip()
				}
			})
	}

	diff(uri: Uri) {
		const tmpDirRef = { value: this.tmpDir }
		this.formatting
			.format(fs.readFileSync(uri.fsPath), uri, () => this.errorTip(), {
				isDiff: true,
				isPartial: false,
				tmpDirRef,
			})
			.then((tempFilePath) => {
				commands.executeCommand('vscode.diff', uri, Uri.file(tempFilePath), 'diff')
			})
			.catch((err) => {
				console.error(err)
			})
	}

	isExcluded(document: TextDocument): boolean {
		if (this.exclude.length > 0 && document.uri.scheme === 'file' && !document.isUntitled) {
			return anymatch(this.exclude, document.uri.path)
		}
		return false
	}

	errorTip() {
		window
			.showErrorMessage(
				// biome-ignore lint/suspicious/noTemplateCurlyInString: VSC expression
				'PHP CS Fixer: executablePath not found. Try setting `"php-cs-fixer.executablePath": "${extensionPath}/php-cs-fixer.phar"` and try again.',
				'Open Output',
			)
			.then((t) => {
				if (t === 'Open Output') {
					showOutput()
				}
			})
		// const config = workspace.getConfiguration('php-cs-fixer')
		// config.update('executablePath', '${extensionPath}/php-cs-fixer.phar', true)
	}

	checkUpdate() {
		setTimeout(() => {
			const config = workspace.getConfiguration('php-cs-fixer')
			const executablePath = config.get<string>('executablePath', 'php-cs-fixer')
			const lastDownloadTimestamp = config.get<number>('lastDownload', 1)
			const oneWeekInMilliseconds = 1000 * 3600 * 24 * 7 // one week;
			const nextDownloadTimestamp = lastDownloadTimestamp + oneWeekInMilliseconds // one week // one week // one week

			const shouldDownload =
				lastDownloadTimestamp !== 0 &&
				// biome-ignore lint/suspicious/noTemplateCurlyInString: VSC expression
				executablePath === '${extensionPath}/php-cs-fixer.phar' &&
				nextDownloadTimestamp < Date.now()

			if (!shouldDownload) {
				return
			}

			console.log('php-cs-fixer: check for updating...')
			const outputPath = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'php-cs-fixer.phar')
			downloadPhpCsFixerFile(outputPath)
				.then(() => {
					config.update('lastDownload', Date.now(), true)
				})
				.catch((err) => {
					console.error(err)
				})
		}, 1000 * 60)
	}
}

export function activate(context: ExtensionContext) {
	const pcf = new PHPCSFixer()

	// context.subscriptions.push(window.onDidChangeActiveTextEditor(te => {
	//     if (pcf.fileAutoSave !== 'off') {
	//         setTimeout(() => lastActiveEditor = te === undefined ? undefined : te.document.uri.toString(), pcf.fileAutoSaveDelay + 100)
	//     }
	// }))

	context.subscriptions.push(
		workspace.onWillSaveTextDocument((event) => {
			if (event.document.languageId === 'php' && pcf.onsave && pcf.editorFormatOnSave === false) {
				const formattedDocument = pcf.formattingProvider(event.document)
				event.waitUntil(formattedDocument)
			}
		}),

		commands.registerTextEditorCommand('php-cs-fixer.fix', (textEditor) => {
			if (textEditor.document.languageId === 'php') {
				pcf.formattingProvider(textEditor.document).then((tes) => {
					if (tes && tes.length > 0) {
						textEditor.edit((eb) => {
							const textRange = tes[0]?.range
							const updatedText = tes[0]?.newText
							if (textRange && updatedText) {
								eb.replace(textRange, updatedText)
							}
						})
					}
				})
			}
		}),

		workspace.onDidChangeTextDocument((event) => {
			if (!(event.document.languageId === 'php')) {
				return
			}
			if (pcf.isExcluded(event.document)) {
				return
			}

			if (pcf.autoFixByBracket) {
				pcf['autoFix'].doAutoFixByBracket(event)
			}
			if (pcf.autoFixBySemicolon) {
				pcf['autoFix'].doAutoFixBySemicolon(event)
			}
		}),

		workspace.onDidChangeConfiguration(() => {
			pcf.loadSettings()
		}),
	)

	if (pcf.documentFormattingProvider) {
		context.subscriptions.push(
			languages.registerDocumentFormattingEditProvider('php', {
				provideDocumentFormattingEdits: (document, options, _token) => {
					return pcf.formattingProvider(document, options)
				},
			}),

			languages.registerDocumentRangeFormattingEditProvider('php', {
				provideDocumentRangeFormattingEdits: (document, range, _options, _token) => {
					return pcf.rangeFormattingProvider(document, range)
				},
			}),
		)
	}

	context.subscriptions.push(
		commands.registerCommand('php-cs-fixer.fix2', (file: Uri | undefined) => {
			let maybeFile = file
			if (!maybeFile) {
				const editor = window.activeTextEditor
				if (editor !== undefined && editor.document.languageId === 'php') {
					maybeFile = editor.document.uri
				}
			}

			if (!maybeFile) return
			if (maybeFile.scheme !== 'file') return

			const stat = fs.statSync(maybeFile.fsPath)
			if (stat.isDirectory()) {
				showOutput()
			}
			pcf.fix(maybeFile)
		}),

		commands.registerCommand('php-cs-fixer.diff', (file: Uri | undefined) => {
			let maybeFile = file
			if (!maybeFile) {
				const editor = window.activeTextEditor
				if (editor !== undefined && editor.document.languageId === 'php') {
					maybeFile = editor.document.uri
				}
			}

			if (!maybeFile) return
			if (maybeFile.scheme !== 'file') return

			pcf.diff(maybeFile)
		}),

		commands.registerCommand('php-cs-fixer.showOutput', () => {
			showOutput()
		}),

		commands.registerCommand('php-cs-fixer.downloadPhar', () => {
			const config = workspace.getConfiguration('php-cs-fixer')
			const outputPath = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'php-cs-fixer.phar')

			statusInfo('downloading php-cs-fixer.phar')
			downloadPhpCsFixerFile(outputPath)
				.then(() => {
					config.update('lastDownload', Date.now(), true)
					statusInfo('php-cs-fixer.phar downloaded')
				})
				.catch((err) => {
					console.error(err)
					statusInfo('php-cs-fixer.phar download failed')
				})
		}),
	)
}

export function deactivate() {
	disposeOutput()
}
