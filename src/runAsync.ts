import { type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio, spawn } from 'node:child_process'

import { output } from './output'

type ProcessExecutionOutput = {
	stdout?: string
	stderr?: string
}

export type RunAsyncResult = Promise<ProcessExecutionOutput>

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
 * Represents an error from a process execution with exit code and output
 */
class ProcessError extends Error {
	exitCode: number
	stdout?: string
	stderr?: string

	constructor(exitCode: number, stdout?: string, stderr?: string) {
		super(`Command failed with exit code #${exitCode}`)
		this.name = 'ProcessError'
		this.exitCode = exitCode
		this.stdout = stdout
		this.stderr = stderr
		// Maintain proper prototype chain for instanceof checks
		Object.setPrototypeOf(this, ProcessError.prototype)
	}
}

/**
 * Manages the result of a process execution
 */
function createProcessResult(
	exitCode: number,
	stdout: BufferCollector,
	stderr: BufferCollector,
): ProcessError | { stdout?: string; stderr?: string } {
	const stdoutStr = stdout.toString()
	const stderrStr = stderr.toString()

	if (exitCode === 0) {
		return {
			stdout: stdoutStr,
			stderr: stderrStr,
		}
	}

	return new ProcessError(exitCode, stdoutStr, stderrStr)
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
	child: ChildProcessWithoutNullStreams,
	stdoutCollector: BufferCollector,
	stderrCollector: BufferCollector,
	onData: (data: Buffer) => void,
	onError: (err: unknown) => void,
	onClose: (code: number) => void,
): void {
	child.stdout.on('data', (data) => {
		stdoutCollector.append(data)
		onData(data)
	})

	child.stderr.on('data', (data) => {
		stderrCollector.append(data)
		onData(data)
	})

	child.on('error', onError)
	child.on('close', onClose)
}

type EventHandlers = {
	onError: (err: unknown) => void
	onClose: (code: number) => ProcessExecutionOutput
}

/**
 * Creates event handlers that clean up listeners
 */
function createEventHandlers(
	child: ChildProcessWithoutNullStreams,
	stdoutCollector: BufferCollector,
	stderrCollector: BufferCollector,
): EventHandlers {
	const cleanup = (): void => {
		child.removeListener('error', onError)
		child.removeListener('close', onClose)
	}

	const onError = (err: unknown): void => {
		cleanup()
		output('runAsync: error')
		output(JSON.stringify(err, null, 2))
		output('runAsync: reject promise')
		throw err
	}

	const onClose = (code: number): { stdout?: string; stderr?: string } => {
		cleanup()

		const result = createProcessResult(code, stdoutCollector, stderrCollector)

		if (result instanceof Error) {
			output('runAsync: error')
			output(JSON.stringify(result, null, 2))
			output('runAsync: reject promise')
			throw result
		}

		output('runAsync: success')
		output(JSON.stringify(result, null, 2))
		output('runAsync: resolve promise')
		return result
	}

	return { onError, onClose }
}

export async function runAsync(
	command: string,
	args: string[],
	options: SpawnOptionsWithoutStdio,
	onData: (data: Buffer) => void = () => {},
): Promise<ProcessExecutionOutput> {
	const normalizedCommand = normalizeCommand(command)
	const childProcessOptions: SpawnOptionsWithoutStdio = {
		...options,
		shell: process.platform === 'win32',
	}

	logSpawnDetails(normalizedCommand, args, childProcessOptions)

	try {
		const child = spawn(normalizedCommand, args, childProcessOptions)

		const stdoutCollector = new BufferCollector()
		const stderrCollector = new BufferCollector()

		return new Promise<ProcessExecutionOutput>((resolve, reject) => {
			const { onError, onClose } = createEventHandlers(child, stdoutCollector, stderrCollector)

			// Wrap handlers to resolve/reject the outer promise
			const handleError = (err: unknown): void => {
				try {
					onError(err)
				} catch (err) {
					reject(err)
				}
			}

			const handleClose = (code: number): void => {
				try {
					const res = onClose(code)
					// onClose returns the ProcessExecutionOutput; resolve with it
					resolve(res)
				} catch (err) {
					reject(err)
				}
			}

			setupProcessListeners(child, stdoutCollector, stderrCollector, onData, handleError, handleClose)
		})
	} catch (err) {
		output('runAsync: error')
		output(JSON.stringify(err, null, 2))
		output('runAsync: reject promise')
		throw err
	}
}
