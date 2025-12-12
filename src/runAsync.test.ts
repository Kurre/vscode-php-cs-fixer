import type EventEmitter from 'node:events'
import { describe, expect, it, vi } from 'vitest'

interface MockChildProcess extends EventEmitter {
	stdout: EventEmitter
	stderr: EventEmitter
	kill: () => void
}

declare global {
	// For accessing the last spawned child process in tests, must be `var` to attach to globalThis
	var __lastChild: MockChildProcess | undefined
}

vi.mock('node:child_process', async () => {
	const { EventEmitter } = await import('node:events')
	class MockStdIO extends EventEmitter {}
	class MockChild extends EventEmitter implements MockChildProcess {
		stdout = new MockStdIO()
		stderr = new MockStdIO()
		kill = () => {}
	}
	const spawn = vi.fn(() => {
		const child = new MockChild()
		globalThis.__lastChild = child
		return child
	})
	return { spawn }
})

// Mock output logger used by runAsync (if any)
vi.mock('./output', () => ({
	output: vi.fn(),
}))

// Import module under test after mocks are registered
import { runAsync } from './runAsync'

// Access the last spawned child from global
const getLastChild = () => globalThis.__lastChild!

describe('runAsync', () => {
	it('resolves on exit code 0 with stdout/stderr collected', async () => {
		const promise = runAsync('echo', ['test'], { cwd: process.cwd() }, undefined)
		const child = getLastChild()
		// Emit data then close
		child.stdout.emit('data', Buffer.from('hello'))
		child.stderr.emit('data', Buffer.from('world'))
		// close event emitted asynchronously
		setTimeout(() => child.emit('close', 0), 0)

		const res = await promise
		expect(res.stdout).toBe('hello')
		expect(res.stderr).toBe('world')
	})

	it('rejects on non-zero exit with ProcessError', async () => {
		const promise = runAsync('cmd', [], { cwd: process.cwd() }, undefined)
		const child = getLastChild()
		child.stdout.emit('data', Buffer.from('good'))
		child.stderr.emit('data', Buffer.from('bad'))
		setTimeout(() => child.emit('close', 1), 0)

		await expect(promise).rejects.toMatchObject({
			exitCode: 1,
			stdout: 'good',
			stderr: 'bad',
		})
	})

	it('rejects when child process emits error event', async () => {
		const promise = runAsync('missing', [], { cwd: process.cwd() }, undefined)
		const child = getLastChild()
		const error = new Error('spawn ENOENT')
		setTimeout(() => child.emit('error', error), 0)

		await expect(promise).rejects.toThrow('spawn ENOENT')
	})

	it('rejects with error when both error and close are emitted', async () => {
		const promise = runAsync('cmd', [], { cwd: process.cwd() }, undefined)
		const child = getLastChild()
		const error = new Error('spawn failed')
		setTimeout(() => {
			child.emit('error', error)
			child.emit('close', 1)
		}, 0)

		await expect(promise).rejects.toThrow('spawn failed')
	})

	it('handles multiple stdout/stderr chunks', async () => {
		const promise = runAsync('echo', ['test'], { cwd: process.cwd() }, undefined)
		const child = getLastChild()
		child.stdout.emit('data', Buffer.from('hel'))
		child.stdout.emit('data', Buffer.from('lo'))
		child.stderr.emit('data', Buffer.from('war'))
		child.stderr.emit('data', Buffer.from('ning'))
		setTimeout(() => child.emit('close', 0), 0)

		const res = await promise
		expect(res.stdout).toBe('hello')
		expect(res.stderr).toBe('warning')
	})

	it('handles empty stdout and stderr', async () => {
		const promise = runAsync('true', [], { cwd: process.cwd() }, undefined)
		const child = getLastChild()
		setTimeout(() => child.emit('close', 0), 0)

		const res = await promise
		expect(res.stdout).toBe('')
		expect(res.stderr).toBe('')
	})

	it('invokes onData callback for stdout and stderr streams', async () => {
		const onData = vi.fn()
		const promise = runAsync('echo', ['test'], { cwd: process.cwd() }, onData)
		const child = getLastChild()
		const outBuf = Buffer.from('out')
		const errBuf = Buffer.from('err')
		child.stdout.emit('data', outBuf)
		child.stderr.emit('data', errBuf)
		setTimeout(() => child.emit('close', 0), 0)

		await promise
		expect(onData).toHaveBeenCalledTimes(2)
		expect(onData).toHaveBeenCalledWith(outBuf)
		expect(onData).toHaveBeenCalledWith(errBuf)
	})

	it('handles various exit codes', async () => {
		for (const code of [2, 127, 255]) {
			const promise = runAsync('cmd', [], { cwd: process.cwd() }, undefined)
			const child = getLastChild()
			setTimeout(() => child.emit('close', code), 0)

			await expect(promise).rejects.toMatchObject({ exitCode: code })
		}
	})

	it('handles large output buffers', async () => {
		const promise = runAsync('cat', ['large.txt'], { cwd: process.cwd() }, undefined)
		const child = getLastChild()
		const largeChunk = 'x'.repeat(10_000)
		child.stdout.emit('data', Buffer.from(largeChunk))
		child.stdout.emit('data', Buffer.from(largeChunk))
		setTimeout(() => child.emit('close', 0), 0)

		const res = await promise
		expect(res.stdout).toBe(largeChunk + largeChunk)
		expect(res.stdout.length).toBe(20_000)
	})
})
