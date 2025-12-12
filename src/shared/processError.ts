/**
 * Represents an error from a process execution with exit code and output
 */
export class ProcessError extends Error {
	exitCode: number
	stdout: string
	stderr: string

	constructor(exitCode: number, stdout: string, stderr: string) {
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
 * Type guard to check if an error is a ProcessError
 */
export function isProcessError(error: unknown): error is ProcessError {
	return error instanceof ProcessError
}
