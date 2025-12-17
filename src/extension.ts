import fs from 'node:fs'
import path from 'node:path'
import {
	commands,
	type ExtensionContext,
	type TextDocument,
	type Uri,
	window,
	workspace,
	languages,
} from 'vscode'

import { AutoFixService } from './autoFixService'
import { loadConfig, type ConfigSchema } from './config'
import { downloadPhpCsFixerFile } from './download-phar'
import { FormattingService } from './formattingService'
import { disposeOutput, showOutput } from './output'

// Re-export for backward compatibility
export { loadConfig, resolveVscodeExpressions, getActiveWorkspaceFolder, type ConfigSchema } from './config'
export { FormattingService } from './formattingService'
export { AutoFixService } from './autoFixService'

/**
 * Checks for php-cs-fixer.phar updates periodically
 */
function checkUpdate(config: ConfigSchema) {
	setTimeout(() => {
		const vscConfig = workspace.getConfiguration('php-cs-fixer')
		const executablePath = vscConfig.get<string>('executablePath', 'php-cs-fixer')
		const lastDownloadTimestamp = vscConfig.get<number>('lastDownload', 1)
		const oneWeekInMilliseconds = 1000 * 3600 * 24 * 7

		const shouldDownload =
			lastDownloadTimestamp !== 0 &&
			// biome-ignore lint/suspicious/noTemplateCurlyInString: VSC expression
			executablePath === '${extensionPath}/php-cs-fixer.phar' &&
			lastDownloadTimestamp + oneWeekInMilliseconds < Date.now()

		if (!shouldDownload) return

		console.log('php-cs-fixer: check for updating...')
		const outputPath = path.join(__dirname, '..', 'php-cs-fixer.phar')
		downloadPhpCsFixerFile(outputPath)
			.then(() => vscConfig.update('lastDownload', Date.now(), true))
			.catch(console.error)
	}, 1000 * 60)
}

export function activate(context: ExtensionContext) {
	// Load immutable config
	let config = loadConfig()

	// Create services
	const formattingService = new FormattingService(config)
	const autoFixService = new AutoFixService(formattingService)

	// Start update check
	checkUpdate(config)

	// Config reload handler
	const reloadConfig = () => {
		config = loadConfig()
		formattingService.updateConfig(config)
	}

	// Event handlers
	context.subscriptions.push(
		// Format on save
		workspace.onWillSaveTextDocument((event) => {
			if (event.document.languageId === 'php' && config.onsave && !config.editorFormatOnSave) {
				const formattedDocument = formattingService.formattingProvider(event.document)
				event.waitUntil(formattedDocument)
			}
		}),

		// Fix command
		commands.registerTextEditorCommand('php-cs-fixer.fix', (textEditor) => {
			if (textEditor.document.languageId === 'php') {
				formattingService.formattingProvider(textEditor.document).then((tes) => {
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

		// Auto-fix on type
		workspace.onDidChangeTextDocument((event) => {
			if (event.document.languageId !== 'php' || formattingService.isFormatting()) {
				return
			}
			if (formattingService.isExcluded(event.document)) {
				return
			}

			if (config.autoFixByBracket) {
				autoFixService.doAutoFixByBracket(event)
			}
			if (config.autoFixBySemicolon) {
				autoFixService.doAutoFixBySemicolon(event)
			}
		}),

		// Config change handler
		workspace.onDidChangeConfiguration(reloadConfig),
	)

	// Register formatting providers
	if (config.documentFormattingProvider) {
		context.subscriptions.push(
			languages.registerDocumentFormattingEditProvider('php', {
				provideDocumentFormattingEdits: (document, options) => {
					return formattingService.formattingProvider(document, options)
				},
			}),

			languages.registerDocumentRangeFormattingEditProvider('php', {
				provideDocumentRangeFormattingEdits: (document, range) => {
					return formattingService.rangeFormattingProvider(document, range)
				},
			}),
		)
	}

	// Register commands
	context.subscriptions.push(
		// fix2 - fix file or folder
		commands.registerCommand('php-cs-fixer.fix2', (file: Uri | undefined) => {
			let maybeFile = file

			if (!maybeFile) {
				maybeFile = window.activeTextEditor?.document.uri
			}

			if (!maybeFile) return
			if (maybeFile.scheme !== 'file') return

			const stat = fs.statSync(maybeFile.fsPath)
			if (stat.isDirectory()) {
				showOutput()
			}
			formattingService.fix(maybeFile)
		}),

		// diff command
		commands.registerCommand('php-cs-fixer.diff', (file: Uri | undefined) => {
			let maybeFile = file

			if (!maybeFile) {
				maybeFile = window.activeTextEditor?.document.uri
			}

			if (!maybeFile) return
			if (maybeFile.scheme !== 'file') return

			formattingService.diff(maybeFile)
		}),

		// show output command
		commands.registerCommand('php-cs-fixer.showOutput', () => {
			showOutput()
		}),

		// download phar command
		commands.registerCommand('php-cs-fixer.downloadPhar', () => {
			const vscConfig = workspace.getConfiguration('php-cs-fixer')
			const outputPath = path.join(__dirname, '..', 'php-cs-fixer.phar')

			downloadPhpCsFixerFile(outputPath)
				.then(() => {
					vscConfig.update('lastDownload', Date.now(), true)
					console.log('php-cs-fixer.phar downloaded successfully')
				})
				.catch((err) => {
					console.error('Failed to download php-cs-fixer.phar:', err)
				})
		}),
	)
}

export function deactivate() {
	disposeOutput()
}
