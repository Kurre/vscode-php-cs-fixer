import { type SpawnOptionsWithoutStdio, spawn } from 'node:child_process'

import { output } from './output'

type RunAsyncResult = Promise<{ stdout?: string; stderr?: string }> & {
	cp?: ReturnType<typeof spawn> | undefined
}

/**
 * Collects and concatenates buffer data from a stream
 */
class BufferCollector {
	private buffer: Buffer | null = null

	append(data: Buffer): void {
		this.buffer = this.buffer ? Buffer.concat([this.buffer, data]) : data
	}

	toString(): string | undefined {
		return this.buffer?.toString()
	}
}

/**
 * Manages the result of a process execution
 */
function createProcessResult(
	exitCode: number,
	stdout: BufferCollector,
	stderr: BufferCollector,
): Error | { stdout?: string; stderr?: string } {
	const stdoutStr = stdout.toString()
	const stderrStr = stderr.toString()

	if (exitCode === 0) {
		return {
			stdout: stdoutStr,
			stderr: stderrStr,
		}
	}

	const error = new Error(`Command failed with exit code #${exitCode}`) as Error & {
		exitCode: number
		stdout?: string
		stderr?: string
	}
	error.exitCode = exitCode
	error.stdout = stdoutStr
	error.stderr = stderrStr
	return error
}

/**
 * Prepares the spawn command for the current platform
 */
function normalizeCommand(command: string): string {
	if (process.platform === 'win32' && command.includes(' ') && !command.startsWith('"')) {
		return `"${command}"`
	}
	return command
}

/**
 * Logs the spawn operation details for debugging
 */
function logSpawnDetails(command: string, args: string[], options: SpawnOptionsWithoutStdio): void {
	output(`runAsync: spawn ${command}`)
	output(JSON.stringify(args, null, 2))
	output(JSON.stringify(options, null, 2))
}

/**
 * Sets up event listeners for the spawned child process
 */
function setupProcessListeners(
	cp: ReturnType<typeof spawn>,
	stdoutCollector: BufferCollector,
	stderrCollector: BufferCollector,
	onData: (data: Buffer) => void,
	onError: (err: unknown) => void,
	onClose: (code: number) => void,
): void {
	cp.stdout?.on('data', (data) => {
		stdoutCollector.append(data)
		onData(data)
	})

	cp.stderr?.on('data', (data) => {
		stderrCollector.append(data)
		onData(data)
	})

	cp.on('error', onError)
	cp.on('close', onClose)
}

/**
 * Creates event handlers that clean up listeners
 */
function createEventHandlers(
	cp: ReturnType<typeof spawn>,
	stdoutCollector: BufferCollector,
	stderrCollector: BufferCollector,
	resolve: (value: { stdout?: string; stderr?: string }) => void,
	reject: (reason?: unknown) => void,
): { onError: (err: unknown) => void; onClose: (code: number) => void } {
	const cleanup = (): void => {
		cp.removeListener('error', onError)
		cp.removeListener('close', onClose)
	}

	const onError = (err: unknown): void => {
		cleanup()
		output('runAsync: error')
		output(JSON.stringify(err, null, 2))
		output('runAsync: reject promise')
		reject(err)
	}

	const onClose = (code: number): void => {
		cleanup()

		const result = createProcessResult(code, stdoutCollector, stderrCollector)

		if (result instanceof Error) {
			output('runAsync: error')
			output(JSON.stringify(result, null, 2))
			output('runAsync: reject promise')
			reject(result)
			return
		}

		output('runAsync: success')
		output(JSON.stringify(result, null, 2))
		output('runAsync: resolve promise')
		resolve(result)
	}

	return { onError, onClose }
}

export function runAsync(
	command: string,
	args: string[],
	options: SpawnOptionsWithoutStdio,
	onData: (data: Buffer) => void = () => {},
): RunAsyncResult {
	const normalizedCommand = normalizeCommand(command)
	const cpOptions = { ...options, shell: process.platform === 'win32' }

	logSpawnDetails(normalizedCommand, args, cpOptions)

	let cp: ReturnType<typeof spawn> | undefined

	try {
		cp = spawn(normalizedCommand, args, cpOptions)
	} catch (err) {
		output('runAsync: error')
		output(JSON.stringify(err, null, 2))
		output('runAsync: reject promise')
		const promise = Promise.reject(err) as RunAsyncResult
		promise.cp = undefined
		return promise
	}

	const { promise, resolve, reject } = Promise.withResolvers<{ stdout?: string; stderr?: string }>()

	const stdoutCollector = new BufferCollector()
	const stderrCollector = new BufferCollector()

	const { onError, onClose } = createEventHandlers(cp, stdoutCollector, stderrCollector, resolve, reject)

	setupProcessListeners(cp, stdoutCollector, stderrCollector, onData, onError, onClose)

	const result = promise as RunAsyncResult
	result.cp = cp
	return result
}
