import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as outputModule from './output'

declare global {
	var window: any
}

describe('output module', () => {
	beforeEach(() => {
		// Reset mocks and dispose of any existing channels/items
		vi.clearAllMocks()
		outputModule.disposeOutput()
	})

	describe('output()', () => {
		it('lazily creates OutputChannel on first call', () => {
			const createOutputChannelSpy = vi.spyOn(window, 'createOutputChannel' as any)

			outputModule.output('test message')

			expect(createOutputChannelSpy).toHaveBeenCalledWith('php-cs-fixer')
			expect(createOutputChannelSpy).toHaveBeenCalledTimes(1)
		})

		it('reuses OutputChannel on subsequent calls', () => {
			const createOutputChannelSpy = vi.spyOn(window, 'createOutputChannel' as any)

			outputModule.output('first message')
			outputModule.output('second message')

			expect(createOutputChannelSpy).toHaveBeenCalledTimes(1)
		})

		it('appends line to OutputChannel', () => {
			const mockChannel = { appendLine: vi.fn(), clear: vi.fn(), dispose: vi.fn(), show: vi.fn() }
			vi.spyOn(window, 'createOutputChannel' as any).mockReturnValue(mockChannel as any)

			outputModule.output('test message')

			expect(mockChannel.appendLine).toHaveBeenCalledWith('test message')
		})
	})

	describe('showOutput()', () => {
		it('lazily creates OutputChannel if needed', () => {
			const createOutputChannelSpy = vi.spyOn(window, 'createOutputChannel' as any)

			outputModule.showOutput()

			expect(createOutputChannelSpy).toHaveBeenCalledWith('php-cs-fixer')
		})

		it('shows OutputChannel with preserveFocus=true', () => {
			const mockChannel = { show: vi.fn(), appendLine: vi.fn(), clear: vi.fn(), dispose: vi.fn() }
			vi.spyOn(window, 'createOutputChannel' as any).mockReturnValue(mockChannel as any)

			outputModule.showOutput()

			expect(mockChannel.show).toHaveBeenCalledWith(true)
		})
	})

	describe('clearOutput()', () => {
		it('clears OutputChannel', () => {
			const mockChannel = { clear: vi.fn(), appendLine: vi.fn(), show: vi.fn(), dispose: vi.fn() }
			vi.spyOn(window, 'createOutputChannel' as any).mockReturnValue(mockChannel as any)

			outputModule.clearOutput()

			expect(mockChannel.clear).toHaveBeenCalled()
		})
	})

	describe('statusInfo()', () => {
		it('lazily creates StatusBarItem on first call', () => {
			const createStatusBarItemSpy = vi.spyOn(window, 'createStatusBarItem' as any)

			outputModule.statusInfo('formatting')

			expect(createStatusBarItemSpy).toHaveBeenCalled()
		})

		it('reuses StatusBarItem on subsequent calls', () => {
			const createStatusBarItemSpy = vi.spyOn(window, 'createStatusBarItem' as any)

			outputModule.statusInfo('formatting')
			outputModule.statusInfo('done')

			expect(createStatusBarItemSpy).toHaveBeenCalledTimes(1)
		})

		it('sets StatusBarItem text with prefix', () => {
			const mockItem = { show: vi.fn(), hide: vi.fn(), dispose: vi.fn(), command: '', tooltip: '', text: '' }
			vi.spyOn(window, 'createStatusBarItem' as any).mockReturnValue(mockItem as any)

			outputModule.statusInfo('formatting')

			expect(mockItem.text).toBe('php-cs-fixer: formatting')
		})

		it('sets command and tooltip on StatusBarItem', () => {
			const mockItem = { show: vi.fn(), hide: vi.fn(), dispose: vi.fn(), command: '', tooltip: '', text: '' }
			vi.spyOn(window, 'createStatusBarItem' as any).mockReturnValue(mockItem as any)

			outputModule.statusInfo('formatting')

			expect(mockItem.command).toBe('php-cs-fixer.showOutput')
			expect(mockItem.tooltip).toBe('php-cs-fixer: show output')
		})

		it('shows StatusBarItem', () => {
			const mockItem = { show: vi.fn(), hide: vi.fn(), dispose: vi.fn(), command: '', tooltip: '', text: '' }
			vi.spyOn(window, 'createStatusBarItem' as any).mockReturnValue(mockItem as any)

			outputModule.statusInfo('formatting')

			expect(mockItem.show).toHaveBeenCalled()
		})

		it('updates text on subsequent calls', () => {
			const mockItem = { show: vi.fn(), hide: vi.fn(), dispose: vi.fn(), command: '', tooltip: '', text: '' }
			vi.spyOn(window, 'createStatusBarItem' as any).mockReturnValue(mockItem as any)

			outputModule.statusInfo('formatting')
			expect(mockItem.text).toBe('php-cs-fixer: formatting')

			outputModule.statusInfo('done')
			expect(mockItem.text).toBe('php-cs-fixer: done')
		})

		it('uses default text "unknown" when not provided', () => {
			const mockItem = { show: vi.fn(), hide: vi.fn(), dispose: vi.fn(), command: '', tooltip: '', text: '' }
			vi.spyOn(window, 'createStatusBarItem' as any).mockReturnValue(mockItem as any)

			outputModule.statusInfo()

			expect(mockItem.text).toBe('php-cs-fixer: unknown')
		})
	})

	describe('hideStatusBar()', () => {
		it('hides StatusBarItem if it exists', () => {
			const mockItem = { show: vi.fn(), hide: vi.fn(), dispose: vi.fn(), command: '', tooltip: '', text: '' }
			vi.spyOn(window, 'createStatusBarItem' as any).mockReturnValue(mockItem as any)

			outputModule.statusInfo('formatting')
			outputModule.hideStatusBar()

			expect(mockItem.hide).toHaveBeenCalled()
		})

		it('safely handles hideStatusBar when StatusBarItem was never created', () => {
			expect(() => outputModule.hideStatusBar()).not.toThrow()
		})
	})

	describe('disposeOutput()', () => {
		it('clears and disposes OutputChannel', () => {
			const mockChannel = { clear: vi.fn(), dispose: vi.fn(), appendLine: vi.fn(), show: vi.fn() }
			vi.spyOn(window, 'createOutputChannel' as any).mockReturnValue(mockChannel as any)

			outputModule.output('test')
			outputModule.disposeOutput()

			expect(mockChannel.clear).toHaveBeenCalled()
			expect(mockChannel.dispose).toHaveBeenCalled()
		})

		it('hides and disposes StatusBarItem', () => {
			const mockItem = { show: vi.fn(), hide: vi.fn(), dispose: vi.fn(), command: '', tooltip: '', text: '' }
			vi.spyOn(window, 'createStatusBarItem' as any).mockReturnValue(mockItem as any)

			outputModule.statusInfo('formatting')
			outputModule.disposeOutput()

			expect(mockItem.hide).toHaveBeenCalled()
			expect(mockItem.dispose).toHaveBeenCalled()
		})

		it('resets references for lazy re-initialization', () => {
			const mockChannel = { clear: vi.fn(), dispose: vi.fn(), appendLine: vi.fn(), show: vi.fn() }
			const createChannelSpy = vi.spyOn(window, 'createOutputChannel' as any).mockReturnValue(mockChannel as any)

			outputModule.output('test')
			outputModule.disposeOutput()
			outputModule.output('another test')

			expect(createChannelSpy).toHaveBeenCalledTimes(2)
		})

		it('safely handles disposeOutput when resources were never created', () => {
			expect(() => outputModule.disposeOutput()).not.toThrow()
		})
	})
})
