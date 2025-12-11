import type { SpawnOptionsWithoutStdio } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
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
	type WorkspaceFolder,
	window,
	workspace,
} from 'vscode'

import { beautify } from './beautifyHtml'
import { downloadPhpCsFixerFile } from './download-phar'
import { clearOutput, disposeOutput, hideStatusBar, output, showOutput, statusInfo } from './output'
import { ProcessError, runAsync } from './runAsync'

const TEMP_DIR = os.tmpdir()
const HOME_DIR = os.homedir()
let isRunning = false

interface PHPCSFixerConfig {
	onsave: boolean
	autoFixByBracket: boolean
	autoFixBySemicolon: boolean
	executablePath: string
	rules: string | Record<string, boolean | string>
	config: string
	formatHtml: boolean
	documentFormattingProvider: boolean
	allowRisky: boolean
	pathMode: 'pathMode' | 'override'
	ignorePHPVersion: boolean
	exclude: string[]
	pharPath: string
	editorFormatOnSave: boolean
	// fileAutoSave: boolean
	// fileAutoSaveDelay: number
	tmpDir: string
}

class PHPCSFixer implements PHPCSFixerConfig {
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

	constructor() {
		this.loadSettings()
		this.checkUpdate()
	}

	loadSettings() {
		const config = workspace.getConfiguration('php-cs-fixer')
		this.onsave = config.get('onsave', false)
		this.autoFixByBracket = config.get('autoFixByBracket', true)
		this.autoFixBySemicolon = config.get('autoFixBySemicolon', false)
		this.executablePath = config.get(
			'executablePath',
			process.platform === 'win32' ? 'php-cs-fixer.bat' : 'php-cs-fixer',
		)

		if (process.platform === 'win32' && config.get('executablePathWindows', '').length > 0) {
			const windowsExecutablePath = config.get('executablePathWindows')
			if (typeof windowsExecutablePath === 'string' && windowsExecutablePath.length > 0) {
				this.executablePath = windowsExecutablePath
			}
		}

		this.executablePath = this.resolveVscodeExpressions(this.executablePath)
		this.rules = config.get('rules', '@PSR12')
		if (typeof this.rules === 'object') {
			this.rules = JSON.stringify(this.rules)
		}
		this.config = config.get('config', '.php-cs-fixer.php;.php-cs-fixer.dist.php;.php_cs;.php_cs.dist')
		this.formatHtml = config.get('formatHtml', false)
		this.documentFormattingProvider = config.get('documentFormattingProvider', true)
		this.allowRisky = config.get('allowRisky', false)
		this.pathMode = config.get('pathMode', 'override')
		this.ignorePHPVersion = config.get('ignorePHPVersion', false)
		this.exclude = config.get('exclude', [])
		this.tmpDir = config.get('tmpDir', '')

		if (this.executablePath.endsWith('.phar')) {
			this.pharPath = this.executablePath.replace(/^php[^ ]* /i, '')
			this.executablePath = workspace.getConfiguration('php').get('validate.executablePath', 'php')
			if (!this.executablePath) {
				this.executablePath = 'php'
			}
		} else {
			this.pharPath = ''
		}

		this.editorFormatOnSave = workspace.getConfiguration('editor').get('formatOnSave') ?? false
		// this.fileAutoSave = workspace.getConfiguration('files').get('autoSave')
		// this.fileAutoSaveDelay = workspace.getConfiguration('files').get('autoSaveDelay', 1000)
	}

	/**
	 * Gets the workspace folder containing the given uri or `null` if no
	 * workspace folder contains it and it cannot be reasonably inferred.
	 */
	getActiveWorkspaceFolder(uri: Uri): WorkspaceFolder | undefined {
		const candidate = workspace.getWorkspaceFolder(uri)

		// Fallback to using the single root workspace's folder. Multi-root
		// workspaces should not be used because its impossible to guess which one
		// the developer intended to use.
		if (candidate === undefined && workspace.workspaceFolders?.length === 1) {
			return workspace.workspaceFolders[0]
		}

		return candidate
	}

	/**
	 * Resolves and interpolates vscode expressions in a given string.
	 *
	 * Supports the following expressions:
	 * - "${workspaceFolder}" or "${workspaceRoot}" (deprecated). Resolves to the
	 *   workspace folder that contains the given `context.uri`.
	 * - "${extensionPath}" Resolves to the root folder of this extension.
	 * - "~" Resolves to the user's home directory.
	 *
	 * @param context Any additional context that may be necessary to resolve
	 * expressions. Expressions with missing context are left as is.
	 */
	resolveVscodeExpressions(input: string, context: { uri?: Uri } = {}) {
		let normalizedInput = input
		const pattern = /^\$\{workspace(Root|Folder)\}/
		if (pattern.test(input) && context.uri) {
			const workspaceFolder = this.getActiveWorkspaceFolder(context.uri)
			// As of time of writing only workspace folders on disk are supported
			// since the php-cs-fixer binary expects to work off local files. UNC
			// filepaths may be supported but this is untested.
			if (workspaceFolder?.uri.scheme === 'file') {
				normalizedInput = input.replace(pattern, workspaceFolder.uri.fsPath)
			}
		}

		normalizedInput = normalizedInput
			// biome-ignore lint/suspicious/noTemplateCurlyInString: VSC expression
			.replace('${extensionPath}', __dirname)
			.replace(/^~\//, `${os.homedir()}/`)

		return path.normalize(normalizedInput)
	}

	getRealExecutablePath(uri: Uri): string | undefined {
		return this.resolveVscodeExpressions(this.executablePath, { uri })
	}

	getArgs(uri: Uri, filePath: string | null = null): string[] {
		const normalizedFilePath = filePath || uri.fsPath

		const args = ['fix', '--using-cache=no', '--format=json']
		if (this.pharPath !== null) {
			args.unshift(this.resolveVscodeExpressions(this.pharPath, { uri }))
		}
		let useConfig = false
		if (this.config.length > 0) {
			const rootUri = this.getActiveWorkspaceFolder(uri)?.uri
			const configFiles = this.config
				.split(';') // allow multiple files definitions semicolon separated values
				.filter((file) => '' !== file) // do not include empty definitions
				.map((file) => file.replace(/^~\//, `${os.homedir()}/`)) // replace ~/ with home dir

			// include also {workspace.rootUri}/.vscode/ & {workspace.rootUri}/
			const searchUris = rootUri?.scheme === 'file' ? [Uri.joinPath(rootUri, '.vscode'), rootUri] : []

			const files = []
			for (const file of configFiles) {
				if (path.isAbsolute(file)) {
					files.push(file)
				} else {
					for (const searchUri of searchUris) {
						files.push(Uri.joinPath(searchUri, file).fsPath)
					}
				}
			}

			for (let i = 0, len = files.length; i < len; i++) {
				const c = files[i]
				if (c && fs.existsSync(c)) {
					if (process.platform === 'win32') {
						args.push(`--config="${c.replace(/"/g, '\\"')}"`)
					} else {
						args.push(`--config=${c}`)
					}
					useConfig = true
					break
				}
			}
		}
		if (!useConfig && this.rules && typeof this.rules === 'string') {
			if (process.platform === 'win32') {
				args.push(`--rules="${(this.rules).replace(/"/g, '\\"')}"`)
			} else {
				args.push(`--rules=${this.rules}`)
			}
		}

		if (this.allowRisky) {
			args.push('--allow-risky=yes')
		}

		if (normalizedFilePath.startsWith(TEMP_DIR)) {
			args.push('--path-mode=override')
		} else {
			args.push(`--path-mode=${this.pathMode}`)
		}
		args.push(normalizedFilePath)

		return args
	}

	format(text: string | Buffer, uri: Uri, isDiff = false, isPartial = false): Promise<string> {
		isRunning = true
		clearOutput()
		isPartial || statusInfo('formatting')

		let filePath = ''
		// if interval between two operations too short, see: https://github.com/junstyle/vscode-php-cs-fixer/issues/76
		// so set different filePath for partial codes;
		if (isPartial) {
			filePath = `${TEMP_DIR}/php-cs-fixer-partial.php`
		} else {
			const tmpDirs = [this.tmpDir, TEMP_DIR, HOME_DIR].filter(Boolean)
			for (const tmpDir of tmpDirs) {
				filePath = path.join(tmpDir, `pcf-tmp${Math.random()}`, uri.fsPath.replace(/^.*[\\/]/, ''))
				try {
					fs.mkdirSync(path.dirname(filePath), { recursive: true })
					this.tmpDir = tmpDir
					break
				} catch (err) {
					console.error(err)
					filePath = ''
				}
			}
			if (!filePath) {
				statusInfo("can't make tmp dir, please check the php-cs-fixer settings, set a writable dir to tmpDir.")
				return Promise.reject()
			}
		}

		fs.writeFileSync(filePath, text)

		const args = this.getArgs(uri, filePath)
		const opts: SpawnOptionsWithoutStdio = {}
		if (uri.scheme === 'file') {
			opts.cwd = path.dirname(uri.fsPath)
		}
		if (this.ignorePHPVersion) {
			opts.env = { ...process.env }
			opts.env.PHP_CS_FIXER_IGNORE_ENV = '1'
		}

		return new Promise((resolve, reject) => {
			const realExecutablePath = this.getRealExecutablePath(uri)
			if (!realExecutablePath) {
				this.errorTip()
				isRunning = false
				return reject(new Error('executablePath not found'))
			}

			runAsync(realExecutablePath, args, opts)
				.then(({ stdout, stderr }) => {
					output(stdout)

					if (isDiff) {
						resolve(filePath)
					} else {
						const result = JSON.parse(stdout)
						if (result && result.files.length > 0) {
							resolve(fs.readFileSync(filePath, 'utf-8'))
						} else {
							const lines = stderr ? stderr.split(/\r?\n/).filter(Boolean) : []
							if (lines.length > 1) {
								output(stderr)
								if (!isPartial) statusInfo(lines[1])
								return reject(new Error(stderr))
							}
							resolve(text.toString())
						}
					}
					hideStatusBar()
				})
				.catch((err) => {
					reject(err)
					output(err.stderr || JSON.stringify(err, null, 2))
					if (!isPartial) statusInfo('failed')

					if (err instanceof ProcessError && err.exitCode) {
						const ERROR_MESSAGES = {
							1: err.stdout ?? 'General error (or PHP minimal requirement not matched).',
							16: 'Configuration error of the application.', //  The path "/file/path.php" is not readable
							32: 'Configuration error of a Fixer.',
							64: 'Exception raised within the application.',
							255:
								err.stderr.match(/PHP (?:Fatal|Parse) error:\s*Uncaught Error:[^\r?\n]+/)?.[0] ??
								'PHP Fatal error, click to show output.',
						} as const

						if (!isPartial) {
							const msg = ERROR_MESSAGES[err.exitCode as keyof typeof ERROR_MESSAGES]
							statusInfo(msg)
						}
					} else if ('code' in err && err.code === 'ENOENT') {
						this.errorTip()
					}
				})
				.finally(() => {
					isRunning = false
					if (!isDiff && !isPartial) {
						fs.rm(path.dirname(filePath), { recursive: true, force: true }, (err) => {
							err && console.error(err)
						})
					}
				})
		})
	}

	fix(uri: Uri) {
		isRunning = true
		clearOutput()
		statusInfo('fixing')

		const args = this.getArgs(uri)
		const opts: SpawnOptionsWithoutStdio = {}
		if (uri.fsPath !== '') {
			opts.cwd = path.dirname(uri.fsPath)
		}
		if (this.ignorePHPVersion) {
			opts.env = { ...process.env }
			opts.env.PHP_CS_FIXER_IGNORE_ENV = '1'
		}

		const realExecutablePath = this.getRealExecutablePath(uri)
		if (!realExecutablePath) {
			this.errorTip()
			isRunning = false
			return
		}
		runAsync(realExecutablePath, args, opts, (data) => {
			output(data.toString())
		})
			.then(({ stdout: _stdout }) => {
				hideStatusBar()
			})
			.catch((err) => {
				statusInfo('failed')
				if (err.code === 'ENOENT') {
					this.errorTip()
				}
			})
			.finally(() => {
				isRunning = false
			})
	}

	diff(uri: Uri) {
		this.format(fs.readFileSync(uri.fsPath), uri, true)
			.then((tempFilePath) => {
				commands.executeCommand('vscode.diff', uri, Uri.file(tempFilePath), 'diff')
			})
			.catch((err) => {
				console.error(err)
			})
	}

	doAutoFixByBracket(event: TextDocumentChangeEvent) {
		if (event.contentChanges.length === 0) return

		const pressedKey = event.contentChanges[0]?.text
		if (pressedKey && !/^\s*\}$/.test(pressedKey)) {
			return
		}

		const editor = window.activeTextEditor
		if (!editor) return

		const document = editor.document
		const originalStart = editor.selection.start

		commands.executeCommand('editor.action.jumpToBracket').then(() => {
			let start = editor.selection.start
			const offsetStart0 = document.offsetAt(originalStart)
			const offsetStart1 = document.offsetAt(start)
			if (offsetStart0 === offsetStart1) {
				return
			}

			const nextChar = document.getText(new Range(start, start.translate(0, 1)))
			if (offsetStart0 - offsetStart1 < 3 || nextChar !== '{') {
				// jumpToBracket to wrong match bracket, do nothing
				commands.executeCommand('cursorUndo')
				return
			}

			let line = document.lineAt(start)
			let code = '<?php\n$__pcf__spliter=0;\n'
			let dealFun = (fixed: string) =>
				fixed.replace(/^<\?php[\s\S]+?\$__pcf__spliter\s*=\s*0;\r?\n/, '').replace(/\s*$/, '')
			let searchIndex = -1
			if (/^\s*\{\s*$/.test(line.text)) {
				// check previous line
				const preline = document.lineAt(line.lineNumber - 1)
				searchIndex = preline.text.search(
					/((if|for|foreach|while|switch|^\s*function\s+\w+|^\s*function\s*)\s*\(.+?\)|(class|trait|interface)\s+[\w ]+|do|try)\s*$/i,
				)
				if (searchIndex > -1) {
					line = preline
				}
			} else {
				searchIndex = line.text.search(
					/((if|for|foreach|while|switch|^\s*function\s+\w+|^\s*function\s*)\s*\(.+?\)|(class|trait|interface)\s+[\w ]+|do|try)\s*\{\s*$/i,
				)
			}

			if (searchIndex > -1) {
				start = line.range.start
			} else {
				// indent + if(1)
				code += `${line.text.match(/^(\s*)\S+/)?.[1]}if(1)`
				dealFun = (fixed: string) => {
					const match = fixed.match(
						/^<\?php[\s\S]+?\$__pcf__spliter\s*=\s*0;\s+?if\s*\(\s*1\s*\)\s*(\{[\s\S]+?\})\s*$/i,
					)?.[1]
					return match ?? ''
				}
			}

			commands.executeCommand('cursorUndo').then(() => {
				const end = editor.selection.start
				const range = new Range(start, end)
				const originalText = code + document.getText(range)

				this.format(originalText, document.uri, false, true)
					.then((text) => {
						const fixedText = dealFun(text)
						if (fixedText !== dealFun(originalText)) {
							editor
								.edit((builder) => {
									builder.replace(range, text)
								})
								.then(() => {
									if (editor.selections.length > 0) {
										commands.executeCommand('cancelSelection')
									}
								})
						}
					})
					.catch((err) => {
						console.log(err)
					})
			})
		})
	}

	doAutoFixBySemicolon(event: TextDocumentChangeEvent) {
		if (event.contentChanges.length === 0) return

		const pressedKey = event.contentChanges[0]?.text
		if (pressedKey !== ';') {
			return
		}

		const editor = window.activeTextEditor
		if (!editor) return

		const line = editor.document.lineAt(editor.selection.start)
		if (line.text.length < 5) {
			return
		}

		// only at last char
		if (line.range.end.character !== editor.selection.end.character + 1) {
			return
		}

		const indent = line.text.match(/^(\s*)/)?.[1]
		const dealFun = (fixed: string) => {
			return fixed.replace(/^<\?php[\s\S]+?\$__pcf__spliter\s*=\s*0;\r?\n/, '').replace(/\s+$/, '')
		}

		const range = line.range
		const originalText = `<?php\n$__pcf__spliter=0;\n${line.text}`

		this.format(originalText, editor.document.uri, false, true)
			.then((text) => {
				const fixedText = dealFun(text)
				if (fixedText !== dealFun(originalText)) {
					editor
						.edit((builder) => {
							builder.replace(range, indent + fixedText)
						})
						.then(() => {
							if (editor.selections.length > 0) {
								commands.executeCommand('cancelSelection')
							}
						})
				}
			})
			.catch((err) => {
				console.log(err)
			})
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

		isRunning = false
		return new Promise((resolve, reject) => {
			const originalText = document.getText()
			const lastLine = document.lineAt(document.lineCount - 1)
			const range = new Range(new Position(0, 0), lastLine.range.end)

			const htmlFormatConfig = workspace.getConfiguration('html').get('format')
			if (typeof htmlFormatConfig !== 'object' || htmlFormatConfig === null) {
				return Promise.reject()
			}
			const htmlOptions = { ...options, ...htmlFormatConfig }

			const originalText2 = this.formatHtml ? beautify(originalText, htmlOptions) : originalText

			this.format(originalText2, document.uri)
				.then((text) => {
					if (text && text !== originalText) {
						resolve([new TextEdit(range, text)])
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

	rangeFormattingProvider(document: TextDocument, range: Range): Promise<TextEdit[]> {
		if (this.isExcluded(document)) {
			return Promise.resolve([])
		}

		// only activeTextEditor, or last activeTextEditor
		// if (window.activeTextEditor === undefined
		//     || (window.activeTextEditor.document.uri.toString() !== document.uri.toString() && lastActiveEditor !== document.uri.toString()))
		//     return

		isRunning = false
		return new Promise((resolve, reject) => {
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

			this.format(originalText, document.uri)
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

exports.activate = (context: ExtensionContext) => {
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
			if (!(event.document.languageId === 'php' && isRunning === false)) {
				return
			}
			if (pcf.isExcluded(event.document)) {
				return
			}

			if (pcf.autoFixByBracket) {
				pcf.doAutoFixByBracket(event)
			}
			if (pcf.autoFixBySemicolon) {
				pcf.doAutoFixBySemicolon(event)
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
	)
}

exports.deactivate = () => {
	disposeOutput()
}
