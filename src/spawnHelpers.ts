import type { SpawnOptionsWithoutStdio } from 'node:child_process'
import path from 'node:path'
import type { Uri } from 'vscode'

export function buildSpawnOptions(uri: Uri, ignorePHPVersion: boolean): SpawnOptionsWithoutStdio {
	const opts: SpawnOptionsWithoutStdio = {}

	if (uri.scheme === 'file' && uri.fsPath !== '') {
		opts.cwd = path.dirname(uri.fsPath)
	}

	if (ignorePHPVersion) {
		opts.env = { ...process.env, PHP_CS_FIXER_IGNORE_ENV: '1' }
	}

	return opts
}

export function quoteArgForPlatform(value: string): string {
	if (process.platform === 'win32') {
		return `"${value.replace(/"/g, '\\"')}"`
	}
	return value
}
