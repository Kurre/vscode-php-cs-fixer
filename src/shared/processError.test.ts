import { describe, expect, it } from 'vitest'

import { isProcessError, ProcessError } from './processError'

describe('ProcessError', () => {
	it('creates an error with exit code and output', () => {
		const error = new ProcessError(1, 'out', 'err')

		expect(error).toBeInstanceOf(Error)
		expect(error).toBeInstanceOf(ProcessError)
		expect(error.exitCode).toBe(1)
		expect(error.stdout).toBe('out')
		expect(error.stderr).toBe('err')
		expect(error.name).toBe('ProcessError')
		expect(error.message).toBe('Command failed with exit code #1')
	})

	it('maintains proper prototype chain for instanceof checks', () => {
		const error = new ProcessError(127, '', 'command not found')

		expect(error instanceof Error).toBe(true)
		expect(error instanceof ProcessError).toBe(true)
	})

	it('formats message with exit code', () => {
		const error = new ProcessError(2, '', 'misuse')

		expect(error.message).toContain('exit code #2')
	})

	it('handles empty stdout and stderr', () => {
		const error = new ProcessError(1, '', '')

		expect(error.stdout).toBe('')
		expect(error.stderr).toBe('')
	})

	it('handles large output in stdout and stderr', () => {
		const largeOut = 'x'.repeat(10000)
		const largeErr = 'y'.repeat(10000)
		const error = new ProcessError(1, largeOut, largeErr)

		expect(error.stdout).toBe(largeOut)
		expect(error.stderr).toBe(largeErr)
		expect(error.stdout.length).toBe(10000)
		expect(error.stderr.length).toBe(10000)
	})
})

describe('isProcessError', () => {
	it('returns true for ProcessError instances', () => {
		const error = new ProcessError(1, 'out', 'err')

		expect(isProcessError(error)).toBe(true)
	})

	it('returns false for regular Error instances', () => {
		const error = new Error('regular error')

		expect(isProcessError(error)).toBe(false)
	})

	it('returns false for non-error values', () => {
		expect(isProcessError(null)).toBe(false)
		expect(isProcessError(undefined)).toBe(false)
		expect(isProcessError('string')).toBe(false)
		expect(isProcessError(123)).toBe(false)
		expect(isProcessError({})).toBe(false)
		expect(isProcessError({ exitCode: 1 })).toBe(false)
	})

	it('works in try-catch blocks', () => {
		try {
			throw new ProcessError(1, 'out', 'err')
		} catch (error) {
			expect(isProcessError(error)).toBe(true)
			if (isProcessError(error)) {
				expect(error.exitCode).toBe(1)
				expect(error.stdout).toBe('out')
				expect(error.stderr).toBe('err')
			}
		}
	})

	it('narrows type correctly', () => {
		const error: unknown = new ProcessError(1, 'out', 'err')

		if (isProcessError(error)) {
			// TypeScript should narrow the type here
			expect(error.exitCode).toBe(1)
			expect(error.stdout).toBe('out')
			expect(error.stderr).toBe('err')
		}
	})
})
