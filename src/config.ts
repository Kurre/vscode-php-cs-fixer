import os from 'node:os'
import path from 'node:path'
import type { Uri, WorkspaceFolder } from 'vscode'
import { workspace } from 'vscode'

export interface ConfigSchema {
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
	tmpDir: string
}

export interface ResolveContext {
	uri?: Uri
}

export function getActiveWorkspaceFolder(uri: Uri): WorkspaceFolder | undefined {
	const candidate = workspace.getWorkspaceFolder(uri)

	if (candidate === undefined && workspace.workspaceFolders?.length === 1) {
		return workspace.workspaceFolders[0]
	}

	return candidate
}

export function resolveVscodeExpressions(input: string, context: ResolveContext = {}): string {
	let normalizedInput = input
	const pattern = /^\$\{workspace(Root|Folder)\}/
	if (pattern.test(input) && context.uri) {
		const workspaceFolder = getActiveWorkspaceFolder(context.uri)
		if (workspaceFolder?.uri.scheme === 'file') {
			normalizedInput = input.replace(pattern, workspaceFolder.uri.fsPath)
		}
	}

	normalizedInput = normalizedInput.replace('${extensionPath}', __dirname).replace(/^~\//, `${os.homedir()}/`)

	return path.normalize(normalizedInput)
}

export function loadConfig(): ConfigSchema {
	const config = workspace.getConfiguration('php-cs-fixer')

	let executablePath = config.get(
		'executablePath',
		process.platform === 'win32' ? 'php-cs-fixer.bat' : 'php-cs-fixer',
	)

	if (process.platform === 'win32' && config.get('executablePathWindows', '').length > 0) {
		const windowsExecutablePath = config.get('executablePathWindows')
		if (typeof windowsExecutablePath === 'string' && windowsExecutablePath.length > 0) {
			executablePath = windowsExecutablePath
		}
	}

	executablePath = resolveVscodeExpressions(executablePath)

	let rules: string | Record<string, boolean | string> = config.get('rules', '@PSR12')
	if (typeof rules === 'object') {
		rules = JSON.stringify(rules)
	}

	const cfg: ConfigSchema = {
		onsave: config.get('onsave', false),
		autoFixByBracket: config.get('autoFixByBracket', true),
		autoFixBySemicolon: config.get('autoFixBySemicolon', false),
		executablePath,
		rules,
		config: config.get('config', '.php-cs-fixer.php;.php-cs-fixer.dist.php;.php_cs;.php_cs.dist'),
		formatHtml: config.get('formatHtml', false),
		documentFormattingProvider: config.get('documentFormattingProvider', true),
		allowRisky: config.get('allowRisky', false),
		pathMode: config.get('pathMode', 'override'),
		ignorePHPVersion: config.get('ignorePHPVersion', false),
		exclude: config.get('exclude', []),
		tmpDir: config.get('tmpDir', ''),
		pharPath: '',
		editorFormatOnSave: workspace.getConfiguration('editor').get('formatOnSave') ?? false,
	}

	if (cfg.executablePath.endsWith('.phar')) {
		cfg.pharPath = cfg.executablePath.replace(/^php[^ ]* /i, '')
		const phpExecutable = workspace.getConfiguration('php').get('validate.executablePath', 'php')
		cfg.executablePath = phpExecutable || 'php'
	}

	return cfg
}
