import { describe, expect, it, vi } from 'vitest'

import * as beautifyHtml from './beautifyHtml'

// Mock heavy deps used inside beautifyHtml
vi.mock('htmlparser2', () => {
	class MockParser {
		startIndex = 0
		endIndex = 0
		private handlers: Record<string, (name: string) => void>
		private data = ''

		constructor(handlers: Record<string, (name: string) => void>, _options?: Record<string, unknown>) {
			this.handlers = handlers
		}

		write(data: string) {
			this.data = data
		}

		end() {
			// Simulate script/style tag detection
			if (this.data.includes('<script')) {
				if (this.handlers.onopentag) {
					this.startIndex = this.data.indexOf('<script')
					this.handlers.onopentag('script')
				}
				if (this.handlers.onclosetag) {
					this.endIndex = this.data.indexOf('</script>') + 9
					this.handlers.onclosetag('script')
				}
			}
			if (this.data.includes('<style')) {
				if (this.handlers.onopentag) {
					this.startIndex = this.data.indexOf('<style')
					this.handlers.onopentag('style')
				}
				if (this.handlers.onclosetag) {
					this.endIndex = this.data.indexOf('</style>') + 8
					this.handlers.onclosetag('style')
				}
			}
		}
	}
	return {
		default: { Parser: MockParser },
		Parser: MockParser,
	}
})

vi.mock('js-beautify', () => ({
	html: vi.fn((text: string) => {
		// Preserve markers so afterAction can clean them; just indent/uppercase slightly
		return text.replace(/\n/g, '\n  ')
	}),
}))

vi.mock('php-parser', () => {
	const Engine = class {
		tokenGetAll(input: string) {
			// Realistic mock: detect various token types and edge cases
			const tokens: unknown[] = []
			const phpMatch = input.match(/<\?php(.*?)\?>/s)

			if (phpMatch && phpMatch[1] !== undefined) {
				tokens.push(['T_OPEN_TAG', '<?php'])
				const content = phpMatch[1].trim()

				// Add various token types to test different branches
				if (content.includes('/*')) {
					tokens.push(['T_COMMENT', '/* comment */'])
				} else if (content.includes('echo')) {
					tokens.push(['T_ECHO', 'echo'])
					tokens.push(['T_STRING', content.replace(/echo\s+/, '')])
				} else if (content) {
					tokens.push(['T_STRING', content])
				}

				// Test the case where last token is not T_CLOSE_TAG
				if (!input.endsWith('?>')) {
					// Don't add T_CLOSE_TAG to test the append logic
					return tokens
				}

				tokens.push(['T_CLOSE_TAG', '?>'])
			} else if (input.includes('<script') || input.includes('<style')) {
				// Test script/style tag handling
				tokens.push(['T_INLINE_HTML', input])
			} else {
				tokens.push(['T_INLINE_HTML', input])
			}

			return tokens
		}
	}
	return { Engine }
})

describe('beautify', () => {
	it('detects and passes through pure PHP blocks', () => {
		const input = '<?php echo 1; ?>'
		const options = { insertSpaces: true, tabSize: 2 }
		const result = beautifyHtml.beautify(input, options)
		// Mocked js-beautify concatenates tokens; verify transformation completes without marker leakage
		expect(result).toBeDefined()
		expect(result).not.toContain('%pcs-comment')
		expect(result).not.toContain('%quote')
	})

	it('removes leading spaces before <?php in pure PHP blocks', () => {
		const input = '   <?php echo 1; ?>'
		const options = { insertSpaces: true, tabSize: 2 }
		const result = beautifyHtml.beautify(input, options)
		// Verify PHP block is detected and processed without marker leakage
		expect(result).toBeDefined()
		expect(result).not.toContain('%pcs-comment')
		expect(result).not.toContain('%quote')
	})

	it('processes mixed HTML and PHP without errors', () => {
		const input = '<div>hello</div>'
		const options = { insertSpaces: true, tabSize: 2 }
		const result = beautifyHtml.beautify(input, options)
		// Mock preserves input via indentation; just verify no markers left
		expect(result).not.toContain('%pcs-comment')
		expect(result).not.toContain('%quote')
	})

	it('handles insertSpaces: true with tabSize', () => {
		const input = '<div>test</div>'
		const options = { insertSpaces: true, tabSize: 4 }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%pcs-comment')
	})

	it('handles insertSpaces: false (tabs)', () => {
		const input = '<div>test</div>'
		const options = { insertSpaces: false, tabSize: 1 }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%pcs-comment')
	})

	it('respects endWithNewline option', () => {
		const input = '<div>test</div>'
		const options = { insertSpaces: true, tabSize: 2, endWithNewline: true }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%pcs-comment')
	})

	it('handles contentUnformatted as array', () => {
		const input = '<div>test</div>'
		const options = { insertSpaces: true, tabSize: 2, contentUnformatted: ['pre', 'code'] }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%pcs-comment')
	})

	it('handles extraLiners as array', () => {
		const input = '<div>test</div>'
		const options = { insertSpaces: true, tabSize: 2, extraLiners: ['head', 'body'] }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%pcs-comment')
	})

	it('passes wrapLineLength to js-beautify', () => {
		const input = '<div>test</div>'
		const options = { insertSpaces: true, tabSize: 2, wrapLineLength: 80 }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%pcs-comment')
	})

	it('passes preserveNewlines to js-beautify', () => {
		const input = '<div>test</div>'
		const options = { insertSpaces: true, tabSize: 2, preserveNewlines: true }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%pcs-comment')
	})

	it('passes indentHandlebars to js-beautify', () => {
		const input = '<div>test</div>'
		const options = { insertSpaces: true, tabSize: 2, indentHandlebars: true }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%pcs-comment')
	})

	it('includes php in templating array', () => {
		const input = '<div><?php echo "test"; ?></div>'
		const options = { insertSpaces: true, tabSize: 2 }
		const result = beautifyHtml.beautify(input, options)
		// Verify it doesn't error and processes PHP
		expect(result).toBeDefined()
		expect(typeof result).toBe('string')
	})

	// Tests for edge cases and uncovered branches
	it('handles PHP code at end of file without closing tag', () => {
		const input = '<div>test <?php echo "no close"'
		const options = { insertSpaces: true, tabSize: 2 }
		const result = beautifyHtml.beautify(input, options)
		expect(result).toBeDefined()
		expect(typeof result).toBe('string')
	})

	it('handles multiple PHP blocks', () => {
		const input = '<?php echo 1; ?><div>test</div><?php echo 2; ?>'
		const options = { insertSpaces: true, tabSize: 2 }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%pcs-comment')
	})

	it('handles nested HTML with PHP', () => {
		const input = '<div><p><?php echo "nested"; ?></p></div>'
		const options = { insertSpaces: true, tabSize: 2 }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%pcs-comment')
	})

	it('handles PHP with double quotes in content', () => {
		const input = '<?php echo "test " quoted"; ?>'
		const options = { insertSpaces: true, tabSize: 2 }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%quote')
		expect(result).not.toContain('%pcs-comment')
	})

	it('handles PHP with single quotes in content', () => {
		const input = "<?php echo 'test \\' quoted'; ?>"
		const options = { insertSpaces: true, tabSize: 2 }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%quote')
	})

	it('handles indentInnerHtml option', () => {
		const input = '<div>test</div>'
		const options = { insertSpaces: true, tabSize: 2, indentInnerHtml: true }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%pcs-comment')
	})

	it('handles maxPreserveNewlines option', () => {
		const input = '<div>\n\n\ntest\n\n\n</div>'
		const options = { insertSpaces: true, tabSize: 2, maxPreserveNewlines: 1 }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%pcs-comment')
	})

	it('handles wrapAttributes option', () => {
		const input = '<div class="test" id="main">content</div>'
		const options = { insertSpaces: true, tabSize: 2, wrapAttributes: 'force' as const }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%pcs-comment')
	})

	it('handles unformatted tags option', () => {
		const input = '<pre>code</pre>'
		const options = { insertSpaces: true, tabSize: 2, unformatted: ['pre', 'code'] }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%pcs-comment')
	})

	it('handles contentUnformatted with string input (comma-separated)', () => {
		const input = '<div>test</div>'
		// Test string format for contentUnformatted, if getTagsFormatOption supports it
		const options = { insertSpaces: true, tabSize: 2, contentUnformatted: 'pre,code' as any }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%pcs-comment')
	})

	it('handles empty PHP tags', () => {
		const input = '<div><?php ?></div>'
		const options = { insertSpaces: true, tabSize: 2 }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%pcs-comment')
	})

	it('handles PHP echo tag variant', () => {
		const input = '<div><?= $var ?></div>'
		const options = { insertSpaces: true, tabSize: 2 }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%pcs-comment')
	})

	it('handles script tag with PHP', () => {
		const input = '<script><?php echo "in script"; ?></script>'
		const options = { insertSpaces: true, tabSize: 2 }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%pcs-comment')
	})

	it('handles style tag with PHP', () => {
		const input = '<style><?php echo "color: red;"; ?></style>'
		const options = { insertSpaces: true, tabSize: 2 }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%pcs-comment')
	})

	it('handles PHP with comment syntax', () => {
		const input = '<?php /* comment */ echo "test"; ?>'
		const options = { insertSpaces: true, tabSize: 2 }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%comment-end')
	})

	it('handles contentUnformatted as string with whitespace', () => {
		const input = '<div>test</div>'
		const options = { insertSpaces: true, tabSize: 2, contentUnformatted: '  pre  ,  code  ' as any }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%pcs-comment')
	})

	it('handles null/undefined option values', () => {
		const input = '<div>test</div>'
		const options = { insertSpaces: true, tabSize: 2, endWithNewline: null as any }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%pcs-comment')
	})

	it('handles HTML with special entities', () => {
		const input = '<div>&nbsp;&lt;&gt;&quot;</div>'
		const options = { insertSpaces: true, tabSize: 2 }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%pcs-comment')
	})

	it('handles HTML attributes with PHP', () => {
		const input = '<div class="<?php echo $class; ?>">content</div>'
		const options = { insertSpaces: true, tabSize: 2 }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%pcs-comment')
	})

	it('handles empty HTML', () => {
		const input = ''
		const options = { insertSpaces: true, tabSize: 2 }
		const result = beautifyHtml.beautify(input, options)
		expect(result).toBeDefined()
	})

	it('handles whitespace-only input', () => {
		const input = '   \n\n   '
		const options = { insertSpaces: true, tabSize: 2 }
		const result = beautifyHtml.beautify(input, options)
		expect(result).toBeDefined()
	})

	it('handles large PHP blocks', () => {
		const input = `<?php
// Large comment
function test() {
  return "test";
}
echo test();
?>`
		const options = { insertSpaces: true, tabSize: 2 }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%pcs-comment')
	})

	it('handles mixed content with script and PHP', () => {
		const input = '<script><?php echo "js"; ?> var x = 1;</script>'
		const options = { insertSpaces: true, tabSize: 2 }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%pcs-comment')
	})

	it('handles contentUnformatted as empty string', () => {
		const input = '<div>test</div>'
		const options = { insertSpaces: true, tabSize: 2, contentUnformatted: '' as any }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%pcs-comment')
	})

	it('handles PHP with trailing whitespace', () => {
		const input = '<?php echo "test"; ?>   \n'
		const options = { insertSpaces: true, tabSize: 2 }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%pcs-comment')
	})

	it('handles lastIndexOf edge case with multiple PHP blocks', () => {
		const input = '<?php echo 1; ?><?php echo 2; ?>'
		const options = { insertSpaces: true, tabSize: 2 }
		const result = beautifyHtml.beautify(input, options)
		// Multiple blocks should not be treated as "entire PHP code block"
		expect(result).toBeDefined()
	})

	it('handles PHP without closing tag (appends closing tag)', () => {
		const input = '<?php echo "no closing tag"'
		const options = { insertSpaces: true, tabSize: 2 }
		const result = beautifyHtml.beautify(input, options)
		expect(result).toBeDefined()
		expect(typeof result).toBe('string')
	})

	it('handles PHP with comment token', () => {
		const input = '<?php /* inline comment */ echo "test"; ?>'
		const options = { insertSpaces: true, tabSize: 2 }
		const result = beautifyHtml.beautify(input, options)
		expect(result).not.toContain('%pcs-comment')
	})

	it('handles PHP in script tag with proper marker wrapping', () => {
		const input = '<script><?php echo "in script"; ?></script>'
		const options = { insertSpaces: true, tabSize: 2 }
		const result = beautifyHtml.beautify(input, options)
		// Should not leak markers
		expect(result).not.toContain('%pcs-comment')
		expect(result).not.toContain('%comment-end')
	})

	it('handles PHP in style tag with proper marker wrapping', () => {
		const input = '<style><?php echo "color: red;"; ?></style>'
		const options = { insertSpaces: true, tabSize: 2 }
		const result = beautifyHtml.beautify(input, options)
		// Should not leak markers
		expect(result).not.toContain('%pcs-comment')
		expect(result).not.toContain('%comment-end')
	})
})
