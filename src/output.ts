import { type OutputChannel, StatusBarAlignment, type StatusBarItem, window } from 'vscode'

let outputChannel: OutputChannel | null = null
let statusBarItem: StatusBarItem | null = null

function getOutput(): OutputChannel {
	if (outputChannel == null) {
		outputChannel = window.createOutputChannel('php-cs-fixer')
	}
	return outputChannel
}

export function output(str: string) {
	getOutput().appendLine(str)
}

export function showOutput() {
	getOutput().show(true)
}

export function clearOutput() {
	getOutput().clear()
}

export function statusInfo(str: string) {
	if (statusBarItem == null) {
		statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left, -10_000_000)
		statusBarItem.command = 'php-cs-fixer.showOutput'
		statusBarItem.tooltip = 'php-cs-fixer: show output'
	}

	statusBarItem.show()
	statusBarItem.text = `php-cs-fixer: ${str}`
}

export function hideStatusBar() {
	statusBarItem?.hide()
}

export function disposeOutput() {
	if (outputChannel) {
		outputChannel.clear()
		outputChannel.dispose()
	}
	if (statusBarItem) {
		statusBarItem.hide()
		statusBarItem.dispose()
	}
	outputChannel = null
	statusBarItem = null
}
