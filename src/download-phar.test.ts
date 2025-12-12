import * as fs from 'node:fs/promises'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as downloadPharModule from './download-phar'

// Mock fs/promises
vi.mock('node:fs/promises')

// Mock crypto for SHA256
vi.mock('node:crypto', () => ({
	createHash: vi.fn((algorithm: string) => {
		if (algorithm !== 'sha256') {
			throw new Error(`Unsupported algorithm: ${algorithm}`)
		}
		return {
			update: vi.fn(function (this: any, data: string | Buffer) {
				this._data = data
				return this
			}),
			digest: vi.fn(function (this: any, encoding: string) {
				// Simple mock: return deterministic hash based on input
				if (typeof this._data === 'string' && this._data === 'test-phar-content') {
					return 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1'
				}
				if (Buffer.isBuffer(this._data) && this._data.toString() === 'test-phar-content') {
					return 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1'
				}
				return 'default-hash-12345678901234567890123456789012345678901234567890'
			}),
		}
	}),
}))

describe('download-phar module', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		// Reset mocks to default resolved behavior
		;(fs.writeFile as any).mockResolvedValue(undefined)
		;(fs.unlink as any).mockResolvedValue(undefined)
	})

	describe('downloadPhpCsFixerFile()', () => {
		it('downloads file successfully when fetch returns ok response', async () => {
			const mockBuffer = new ArrayBuffer(10)
			const mockResponse = {
				ok: true,
				status: 200,
				statusText: 'OK',
				arrayBuffer: vi.fn().mockResolvedValue(mockBuffer),
			}
			global.fetch = vi.fn().mockResolvedValue(mockResponse as any)

			const outputPath = '/tmp/php-cs-fixer.phar'
			await downloadPharModule.downloadPhpCsFixerFile(outputPath)

			expect(global.fetch).toHaveBeenCalledWith('https://cs.symfony.com/download/php-cs-fixer-v3.phar')
			expect(mockResponse.arrayBuffer).toHaveBeenCalled()
			expect(fs.writeFile).toHaveBeenCalledWith(outputPath, expect.any(Uint8Array))
		})

		it('throws error when fetch returns non-ok response', async () => {
			const mockResponse = {
				ok: false,
				status: 404,
				statusText: 'Not Found',
				arrayBuffer: vi.fn(),
			}
			global.fetch = vi.fn().mockResolvedValue(mockResponse as any)

			const outputPath = '/tmp/php-cs-fixer.phar'

			await expect(downloadPharModule.downloadPhpCsFixerFile(outputPath)).rejects.toThrow(
				'Failed to download: 404 Not Found',
			)
			expect(fs.unlink).toHaveBeenCalledWith(outputPath)
		})

		it('throws error with 500 server error', async () => {
			const mockResponse = {
				ok: false,
				status: 500,
				statusText: 'Internal Server Error',
				arrayBuffer: vi.fn(),
			}
			global.fetch = vi.fn().mockResolvedValue(mockResponse as any)

			const outputPath = '/tmp/php-cs-fixer.phar'

			await expect(downloadPharModule.downloadPhpCsFixerFile(outputPath)).rejects.toThrow(
				'Failed to download: 500 Internal Server Error',
			)
			expect(fs.unlink).toHaveBeenCalledWith(outputPath)
		})

		it('cleans up file on fetch error', async () => {
			global.fetch = vi.fn().mockRejectedValue(new Error('Network error'))

			const outputPath = '/tmp/php-cs-fixer.phar'

			await expect(downloadPharModule.downloadPhpCsFixerFile(outputPath)).rejects.toThrow('Network error')
			expect(fs.unlink).toHaveBeenCalledWith(outputPath)
		})

		it('cleans up file on arrayBuffer error', async () => {
			const mockResponse = {
				ok: true,
				status: 200,
				statusText: 'OK',
				arrayBuffer: vi.fn().mockRejectedValue(new Error('Failed to read response')),
			}
			global.fetch = vi.fn().mockResolvedValue(mockResponse as any)

			const outputPath = '/tmp/php-cs-fixer.phar'

			await expect(downloadPharModule.downloadPhpCsFixerFile(outputPath)).rejects.toThrow(
				'Failed to read response',
			)
			expect(fs.unlink).toHaveBeenCalledWith(outputPath)
		})

		it('cleans up file on writeFile error', async () => {
			const mockBuffer = new ArrayBuffer(10)
			const mockResponse = {
				ok: true,
				status: 200,
				statusText: 'OK',
				arrayBuffer: vi.fn().mockResolvedValue(mockBuffer),
			}
			global.fetch = vi.fn().mockResolvedValue(mockResponse as any)
			;(fs.writeFile as any).mockRejectedValue(new Error('Write failed'))

			const outputPath = '/tmp/php-cs-fixer.phar'

			await expect(downloadPharModule.downloadPhpCsFixerFile(outputPath)).rejects.toThrow('Write failed')
			expect(fs.unlink).toHaveBeenCalledWith(outputPath)
		})

		it('handles redirection (200 success after redirect)', async () => {
			const mockBuffer = new ArrayBuffer(512)
			const mockResponse = {
				ok: true,
				status: 200,
				statusText: 'OK',
				arrayBuffer: vi.fn().mockResolvedValue(mockBuffer),
			}
			global.fetch = vi.fn().mockResolvedValue(mockResponse as any)

			const outputPath = '/tmp/php-cs-fixer.phar'
			await downloadPharModule.downloadPhpCsFixerFile(outputPath)

			expect(fs.writeFile).toHaveBeenCalledWith(outputPath, expect.any(Uint8Array))
		})

		it('logs messages to console during download process', async () => {
			const consoleLogSpy = vi.spyOn(console, 'log')
			const mockBuffer = new ArrayBuffer(10)
			const mockResponse = {
				ok: true,
				status: 200,
				statusText: 'OK',
				arrayBuffer: vi.fn().mockResolvedValue(mockBuffer),
			}
			global.fetch = vi.fn().mockResolvedValue(mockResponse as any)

			const outputPath = '/tmp/php-cs-fixer.phar'
			await downloadPharModule.downloadPhpCsFixerFile(outputPath)

			expect(consoleLogSpy).toHaveBeenCalledWith('start to download php-cs-fixer.phar')
			expect(consoleLogSpy).toHaveBeenCalledWith('download php-cs-fixer.phar successfully.')
			consoleLogSpy.mockRestore()
		})
	})
})
