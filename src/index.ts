import type { SpawnOptionsWithoutStdio } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

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
import { clearOutput, disposeOutput, hideStatusBar, output, showOutput, statusInfo } from './output'
import { runAsync } from './runAsync'

const TmpDir = os.tmpdir()
const HomeDir = os.homedir()
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
		// super()
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
			if (workspaceFolder != null && workspaceFolder.uri.scheme === 'file') {
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
		if (this.pharPath != null) {
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
			const searchUris =
				rootUri != null && rootUri.scheme === 'file' ? [Uri.joinPath(rootUri, '.vscode'), rootUri] : []

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
		if (!useConfig && this.rules) {
			if (process.platform === 'win32') {
				args.push(`--rules="${(this.rules as string).replace(/"/g, '\\"')}"`)
			} else {
				args.push(`--rules=${this.rules}`)
			}
		}
		if (this.allowRisky) {
			args.push('--allow-risky=yes')
		}

		if (normalizedFilePath.startsWith(TmpDir)) {
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

		let filePath: string
		// if interval between two operations too short, see: https://github.com/junstyle/vscode-php-cs-fixer/issues/76
		// so set different filePath for partial codes;
		if (isPartial) {
			filePath = `${TmpDir}/php-cs-fixer-partial.php`
		} else {
			const tmpDirs = [this.tmpDir, TmpDir, HomeDir].filter(Boolean)
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
			opts.env = Object.create(process.env)
			opts.env.PHP_CS_FIXER_IGNORE_ENV = '1'
		}

		return new Promise((resolve, reject) => {
			runAsync(this.getRealExecutablePath(uri), args, opts)
				.then(({ stdout, stderr }) => {
					output(stdout)

					if (isDiff) {
						resolve(filePath)
					} else {
						const result = JSON.parse(stdout)
						if (result && result.files.length > 0) {
							resolve(fs.readFileSync(filePath, 'utf-8'))
						} else {
							const lines = stderr.split(/\r?\n/).filter(Boolean)
							if (lines.length > 1) {
								output(stderr)
								isPartial || statusInfo(lines[1])
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
					isPartial || statusInfo('failed')

					if (err.code === 'ENOENT') {
						this.errorTip()
					} else if (err.exitCode) {
						const msgs = {
							1: err.stdout || 'General error (or PHP minimal requirement not matched).',
							16: 'Configuration error of the application.', //  The path "/file/path.php" is not readable
							32: 'Configuration error of a Fixer.',
							64: 'Exception raised within the application.',
							255:
								err.stderr?.match(/PHP (?:Fatal|Parse) error:\s*Uncaught Error:[^\r?\n]+/)?.[0] ||
								'PHP Fatal error, click to show output.',
						}
						isPartial || statusInfo(msgs[err.exitCode])
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
		if (uri.fsPath != '') {
			opts.cwd = path.dirname(uri.fsPath)
		}
		if (this.ignorePHPVersion) {
			opts.env = Object.create(process.env)
			opts.env.PHP_CS_FIXER_IGNORE_ENV = '1'
		}

		runAsync(this.getRealExecutablePath(uri), args, opts, (data) => {
			output(data.toString())
		})
			.then(({ stdout }) => {
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
		const pressedKey = event.contentChanges[0].text
		// console.log(pressedKey);
		if (!/^\s*\}$/.test(pressedKey)) {
			return
		}

		const editor = window.activeTextEditor
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
			if (offsetStart0 - offsetStart1 < 3 || nextChar != '{') {
				// jumpToBracket to wrong match bracket, do nothing
				commands.executeCommand('cursorUndo')
				return
			}

			let line = document.lineAt(start)
			let code = '<?php\n$__pcf__spliter=0;\n'
			let dealFun = (fixed) =>
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
				code += `${line.text.match(/^(\s*)\S+/)[1]}if(1)`
				dealFun = (fixed) => {
					const match = fixed.match(
						/^<\?php[\s\S]+?\$__pcf__spliter\s*=\s*0;\s+?if\s*\(\s*1\s*\)\s*(\{[\s\S]+?\})\s*$/i,
					)
					return match != null ? match[1] : ''
				}
			}

			commands.executeCommand('cursorUndo').then(() => {
				const end = editor.selection.start
				const range = new Range(start, end)
				const originalText = code + document.getText(range)

				this.format(originalText, document.uri, false, true)
					.then((text) => {
						text = dealFun(text)
						if (text != dealFun(originalText)) {
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
		const pressedKey = event.contentChanges[0].text
		// console.log(pressedKey);
		if (pressedKey != ';') {
			return
		}
		const editor = window.activeTextEditor
		const line = editor.document.lineAt(editor.selection.start)
		if (line.text.length < 5) {
			return
		}
		// only at last char
		if (line.range.end.character != editor.selection.end.character + 1) {
			return
		}

		const indent = line.text.match(/^(\s*)/)[1]
		const dealFun = (fixed) =>
			fixed.replace(/^<\?php[\s\S]+?\$__pcf__spliter\s*=\s*0;\r?\n/, '').replace(/\s+$/, '')
		const range = line.range
		const originalText = `<?php\n$__pcf__spliter=0;\n${line.text}`

		this.format(originalText, editor.document.uri, false, true)
			.then((text) => {
				text = dealFun(text)
				if (text != dealFun(originalText)) {
					text = indent + text
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
	}

	formattingProvider(document: TextDocument, options: FormattingOptions): Promise<TextEdit[]> {
		if (this.isExcluded(document)) {
			return
		}

		// only activeTextEditor, or last activeTextEditor
		// if (window.activeTextEditor === undefined
		//     || (window.activeTextEditor.document.uri.toString() != document.uri.toString() && lastActiveEditor != document.uri.toString()))
		//     return

		isRunning = false
		return new Promise((resolve, reject) => {
			const originalText = document.getText()
			const lastLine = document.lineAt(document.lineCount - 1)
			const range = new Range(new Position(0, 0), lastLine.range.end)
			const htmlOptions = Object.assign(options, workspace.getConfiguration('html').get('format'))
			const originalText2 = this.formatHtml ? beautify(originalText, htmlOptions) : originalText

			this.format(originalText2, document.uri)
				.then((text) => {
					if (text && text != originalText) {
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
			return
		}

		// only activeTextEditor, or last activeTextEditor
		// if (window.activeTextEditor === undefined
		//     || (window.activeTextEditor.document.uri.toString() != document.uri.toString() && lastActiveEditor != document.uri.toString()))
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
					if (addPHPTag) {
						text = text.replace(/^<\?php\r?\n/, '')
					}
					if (text && text != originalText) {
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

	isExcluded(document: TextDocument): boolean {
		if (this.exclude.length > 0 && document.uri.scheme === 'file' && !document.isUntitled) {
			return anymatch(this.exclude, document.uri.path)
		}
		return false
	}

	errorTip() {
		window
			.showErrorMessage(
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
			const executablePath = config.get('executablePath', 'php-cs-fixer')
			const lastDownload = config.get('lastDownload', 1)
			if (
				!(
					lastDownload !== 0 &&
					executablePath === '${extensionPath}/php-cs-fixer.phar' &&
					lastDownload + 1000 * 3600 * 24 * 7 < new Date().getTime()
				)
			) {
				return
			}
			console.log('php-cs-fixer: check for updating...')
			const { DownloaderHelper } = require('node-downloader-helper')
			const dl = new DownloaderHelper('https://cs.symfony.com/download/php-cs-fixer-v3.phar', __dirname, {
				fileName: 'php-cs-fixer.phar.tmp',
				override: true,
			})
			dl.on('end', () => {
				fs.unlinkSync(path.join(__dirname, 'php-cs-fixer.phar'))
				fs.renameSync(path.join(__dirname, 'php-cs-fixer.phar.tmp'), path.join(__dirname, 'php-cs-fixer.phar'))
				config.update('lastDownload', new Date().getTime(), true)
			})
			dl.start()
		}, 1000 * 60)
	}
}

exports.activate = (context: ExtensionContext) => {
	const pcf = new PHPCSFixer()

	// context.subscriptions.push(window.onDidChangeActiveTextEditor(te => {
	//     if (pcf.fileAutoSave != 'off') {
	//         setTimeout(() => lastActiveEditor = te === undefined ? undefined : te.document.uri.toString(), pcf.fileAutoSaveDelay + 100)
	//     }
	// }))

	context.subscriptions.push(
		workspace.onWillSaveTextDocument((event) => {
			if (event.document.languageId === 'php' && pcf.onsave && pcf.editorFormatOnSave === false) {
				event.waitUntil(pcf.formattingProvider(event.document, {} as any))
			}
		}),
	)

	context.subscriptions.push(
		commands.registerTextEditorCommand('php-cs-fixer.fix', (textEditor) => {
			if (textEditor.document.languageId === 'php') {
				pcf.formattingProvider(textEditor.document, {} as any).then((tes) => {
					if (tes && tes.length > 0) {
						textEditor.edit((eb) => {
							eb.replace(tes[0].range, tes[0].newText)
						})
					}
				})
			}
		}),
	)

	context.subscriptions.push(
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
	)

	context.subscriptions.push(
		workspace.onDidChangeConfiguration(() => {
			pcf.loadSettings()
		}),
	)

	if (pcf.documentFormattingProvider) {
		context.subscriptions.push(
			languages.registerDocumentFormattingEditProvider('php', {
				provideDocumentFormattingEdits: (document, options, token) => {
					return pcf.formattingProvider(document, options)
				},
			}),
		)

		context.subscriptions.push(
			languages.registerDocumentRangeFormattingEditProvider('php', {
				provideDocumentRangeFormattingEdits: (document, range, options, token) => {
					return pcf.rangeFormattingProvider(document, range)
				},
			}),
		)
	}

	context.subscriptions.push(
		commands.registerCommand('php-cs-fixer.fix2', (f) => {
			if (f === undefined) {
				const editor = window.activeTextEditor
				if (editor != undefined && editor.document.languageId === 'php') {
					f = editor.document.uri
				}
			}
			if (!(f && f.scheme === 'file')) {
				return
			}
			const stat = fs.statSync(f.fsPath)
			if (stat.isDirectory()) {
				showOutput()
			}
			if (f != undefined) {
				pcf.fix(f)
			}
		}),
	)

	context.subscriptions.push(
		commands.registerCommand('php-cs-fixer.diff', (f) => {
			if (f === undefined) {
				const editor = window.activeTextEditor
				if (editor != undefined && editor.document.languageId === 'php') {
					f = editor.document.uri
				}
			}
			if (f && f.scheme === 'file' && f != undefined) {
				pcf.diff(f)
			}
		}),
	)

	context.subscriptions.push(commands.registerCommand('php-cs-fixer.showOutput', showOutput))
}

exports.deactivate = () => {
	disposeOutput()
}
