import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import anymatch from 'anymatch'
import {
	commands,
	Position,
	type Range,
	type TextDocument,
	type TextEdit,
	Uri,
	Range as VSRange,
	TextEdit as VSTextEdit,
	type Uri as VscodeUri,
	window,
	workspace,
} from 'vscode'

import { type BeautifyOptions, beautify } from './beautifyHtml'
import type { ConfigSchema } from './config'
import { getActiveWorkspaceFolder, resolveVscodeExpressions } from './config'
import { clearOutput, hideStatusBar, output, statusInfo } from './output'
import { runAsync } from './runAsync'
import { ProcessError } from './shared/processError'
import { buildSpawnOptions, quoteArgForPlatform } from './spawnHelpers'

const TEMP_DIR = os.tmpdir()
const HOME_DIR = os.homedir()

export class FormattingService {
	private isRunning = false

	constructor(private config: ConfigSchema) {}

	updateConfig(newConfig: ConfigSchema) {
		this.config = newConfig
	}

	isFormatting(): boolean {
		return this.isRunning
	}

	getRealExecutablePath(uri: VscodeUri): string | undefined {
		return resolveVscodeExpressions(this.config.executablePath, { uri })
	}

	getArgs(uri: VscodeUri, filePath: string | null = null): string[] {
		const normalizedFilePath = filePath || uri.fsPath

		const args = ['fix', '--using-cache=no', '--format=json']
		if (this.config.pharPath !== null) {
			args.unshift(resolveVscodeExpressions(this.config.pharPath, { uri }))
		}
		let useConfig = false
		if (this.config.config.length > 0) {
			const rootUri = getActiveWorkspaceFolder(uri)?.uri
			const configFiles = this.config.config
				.split(';')
				.filter((file) => file !== '')
				.map((file) => file.replace(/^~\//, `${os.homedir()}/`))

			const searchUris = rootUri?.scheme === 'file' ? [Uri.joinPath(rootUri, '.vscode'), rootUri] : []

			const files: string[] = []
			for (const file of configFiles) {
				if (path.isAbsolute(file)) {
					files.push(file)
				} else {
					for (const searchUri of searchUris) {
						files.push(Uri.joinPath(searchUri, file).fsPath)
					}
				}
			}

			for (const c of files) {
				if (c && fs.existsSync(c)) {
					const configValue = process.platform === 'win32' ? quoteArgForPlatform(c) : c
					args.push(`--config=${configValue}`)
					useConfig = true
					break
				}
			}
		}
		if (!useConfig && this.config.rules && typeof this.config.rules === 'string') {
			const rulesValue = process.platform === 'win32' ? quoteArgForPlatform(this.config.rules) : this.config.rules
			args.push(`--rules=${rulesValue}`)
		}

		if (this.config.allowRisky) {
			args.push('--allow-risky=yes')
		}

		if (normalizedFilePath.startsWith(TEMP_DIR)) {
			args.push('--path-mode=override')
		} else {
			args.push(`--path-mode=${this.config.pathMode}`)
		}
		args.push(normalizedFilePath)

		return args
	}

	async format(
		text: string | Buffer,
		uri: Uri,
		errorTip: () => void,
		options: { isDiff?: boolean; isPartial?: boolean; tmpDirRef: { value: string } },
	): Promise<string> {
		const { isDiff = false, isPartial = false, tmpDirRef } = options

		if (this.isRunning && !isPartial) {
			return Promise.reject(new Error('php-cs-fixer is already running'))
		}

		this.isRunning = true
		clearOutput()
		isPartial || statusInfo('formatting')

		let filePath = ''
		if (isPartial) {
			filePath = `${TEMP_DIR}/php-cs-fixer-partial.php`
		} else {
			const tmpDirs = [tmpDirRef.value, TEMP_DIR, HOME_DIR].filter(Boolean)
			for (const tmpDir of tmpDirs) {
				filePath = path.join(tmpDir, `pcf-tmp${Math.random()}`, uri.fsPath.replace(/^.*[\\/]/, ''))
				try {
					fs.mkdirSync(path.dirname(filePath), { recursive: true })
					tmpDirRef.value = tmpDir
					break
				} catch (err) {
					console.error(err)
					filePath = ''
				}
			}
			if (!filePath) {
				statusInfo("can't make tmp dir, please check the php-cs-fixer settings, set a writable dir to tmpDir.")
				this.isRunning = false
				return Promise.reject(
					new Error(
						"can't make tmp dir, please check the php-cs-fixer settings, set a writable dir to tmpDir.",
					),
				)
			}
		}

		fs.writeFileSync(filePath, text)

		const args = this.getArgs(uri, filePath)
		const opts = buildSpawnOptions(uri, this.config.ignorePHPVersion)

		try {
			const realExecutablePath = this.getRealExecutablePath(uri)
			if (!realExecutablePath) {
				errorTip()
				this.isRunning = false
				throw new Error('executablePath not found')
			}

			const { stdout, stderr } = await runAsync(realExecutablePath, args, opts)
			output(stdout)

			if (isDiff) {
				return filePath
			}

			const result = JSON.parse(stdout)
			if (result && result.files.length > 0) {
				return fs.readFileSync(filePath, 'utf-8')
			}

			const lines = stderr ? stderr.split(/\r?\n/).filter(Boolean) : []
			if (lines.length > 1) {
				output(stderr)
				if (!isPartial) statusInfo(lines[1])
				throw new Error(stderr)
			}

			return text.toString()
		} catch (err: unknown) {
			const errorMessage =
				typeof err === 'object' && err !== null && 'stderr' in err && typeof err.stderr === 'string'
					? err.stderr
					: JSON.stringify(err, null, 2)
			output(errorMessage)
			if (!isPartial) statusInfo('failed')

			if (err instanceof ProcessError && err.exitCode) {
				const ERROR_MESSAGES = {
					1: err.stdout ?? 'General error (or PHP minimal requirement not matched).',
					16: 'Configuration error of the application.',
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
			} else if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
				errorTip()
			}

			throw err
		} finally {
			this.isRunning = false
			if (!isDiff && !isPartial) {
				fs.rm(path.dirname(filePath), { recursive: true, force: true }, (err) => {
					err && console.error(err)
				})
			}

			if (!isPartial) {
				hideStatusBar()
			}
		}
	}

	getIsRunning() {
		return this.isRunning
	}

	isExcluded(document: TextDocument): boolean {
		if (this.config.exclude.length > 0 && document.uri.scheme === 'file' && !document.isUntitled) {
			return anymatch(this.config.exclude, document.uri.path)
		}
		return false
	}

	async formattingProvider(document: TextDocument, options?: Partial<BeautifyOptions>): Promise<TextEdit[]> {
		if (this.isExcluded(document)) {
			return Promise.resolve([])
		}

		return new Promise((resolve, reject) => {
			const originalText = document.getText()
			const lastLine = document.lineAt(document.lineCount - 1)
			const range = new VSRange(new Position(0, 0), lastLine.range.end)

			const htmlFormatConfig = workspace.getConfiguration('html').get('format')
			if (typeof htmlFormatConfig !== 'object' || htmlFormatConfig === null) {
				reject(new Error('Invalid HTML format configuration'))
				return
			}
			const htmlOptions = { ...options, ...htmlFormatConfig } as BeautifyOptions

			const originalText2 = this.config.formatHtml ? beautify(originalText, htmlOptions) : originalText

			const tmpDirRef = { value: this.config.tmpDir }
			this.format(originalText2, document.uri, () => this.errorTip(), {
				isDiff: false,
				isPartial: false,
				tmpDirRef,
			})
				.then((text) => {
					if (text && text !== originalText) {
						resolve([new VSTextEdit(range, text)])
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

	async rangeFormattingProvider(document: TextDocument, range: Range): Promise<TextEdit[]> {
		if (this.isExcluded(document)) {
			return Promise.resolve([])
		}

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

			const tmpDirRef = { value: this.config.tmpDir }
			this.format(originalText, document.uri, () => this.errorTip(), {
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
						resolve([new VSTextEdit(range, fixedText)])
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

	fix(uri: VscodeUri) {
		clearOutput()
		statusInfo('fixing')

		const args = this.getArgs(uri)
		const opts = buildSpawnOptions(uri, this.config.ignorePHPVersion)

		const realExecutablePath = this.getRealExecutablePath(uri)
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
			.catch((err: unknown) => {
				statusInfo('failed')
				if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
					this.errorTip()
				}
			})
	}

	diff(uri: VscodeUri) {
		const tmpDirRef = { value: this.config.tmpDir }
		this.format(fs.readFileSync(uri.fsPath), uri, () => this.errorTip(), {
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

	private errorTip() {
		window
			.showErrorMessage(
				'PHP CS Fixer: executablePath not found. Try setting `"php-cs-fixer.executablePath": "${extensionPath}/php-cs-fixer.phar"` and try again.',
			)
			.then((selection) => {
				if (selection) {
					commands.executeCommand('workbench.action.openSettings', 'php-cs-fixer.executablePath')
				}
			})
	}
}
