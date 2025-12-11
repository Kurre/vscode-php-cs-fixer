import htmlparser from 'htmlparser2'
import { html as beautifyHtml, type HTMLBeautifyOptions } from 'js-beautify'
import { Engine } from 'php-parser'

import type { CamelizeKeys } from './types'

// initialize a new parser instance
const parser = new Engine({
	parser: {
		extractDoc: true,
		php7: true,
	},
	ast: {
		withPositions: true,
	},
})

function getFormatOption<T extends Record<string, unknown>, K extends keyof T>(
	options: T | undefined,
	key: K,
	defaultValue?: T[K],
): T[K] | undefined {
	if (options && Object.hasOwn(options, key)) {
		const value = options[key]
		if (value !== null) {
			return value as T[K]
		}
	}
	return defaultValue
}

function getTagsFormatOption<T extends Record<string, unknown>, K extends keyof T>(
	options: T,
	key: K,
	defaultValue?: T[K],
): T[K] | undefined {
	const list = getFormatOption(options, key)
	if (typeof list !== 'string') {
		return defaultValue
	}

	if (list.length > 0) {
		return list.split(',').map((t) => t.trim().toLowerCase()) as T[K]
	}
	return [] as T[K]
}

/**
 * Escapes special characters in token content
 */
function escapeTokenContent(content: string, isComment: boolean): string {
	const rules: Array<[RegExp, string]> = [
		[/"/g, 'pcs%quote#1'],
		[/'/g, 'pcs%quote~2'],
		[isComment ? /-->/g : /\*\//g, isComment ? '-%comment-end#->' : '*%comment-end#/'],
	]

	return rules.reduce((str, [pattern, replacement]) => str.replace(pattern, replacement), content)
}

/**
 * Wraps trailing whitespace in token content
 */
function wrapTrailingWhitespace(content: string, wrapper: string): string {
	const match = content.match(/(\S+)(\s+)$/)
	return match ? `${match[1]}${wrapper}${match[2]}` : `${content}${wrapper}`
}

/**
 * Processes a single token and returns the output string(s)
 */
function processToken(token: unknown, isInScriptStyleTag: boolean): { strings: string[]; length: number } {
	// String token
	if (typeof token === 'string') {
		return { strings: [token], length: token.length }
	}

	// Token tuple: [type, content, ...]
	if (!Array.isArray(token)) {
		return { strings: [], length: 0 }
	}

	const [type, content] = token as [string, string | undefined]
	if (!content) {
		return { strings: [], length: 0 }
	}

	const isOpenTag = type === 'T_OPEN_TAG' || type === 'T_OPEN_TAG_WITH_ECHO'
	const isCloseTag = type === 'T_CLOSE_TAG'
	const isInlineHtml = type === 'T_INLINE_HTML'

	let result: string[] = []

	if (isInScriptStyleTag) {
		if (isOpenTag) {
			result = [`/*%pcs-comment-start#${content}`]
		} else if (isCloseTag) {
			result = [wrapTrailingWhitespace(content, '%pcs-comment-end#*/')]
		} else if (isInlineHtml) {
			result = [content]
		} else {
			result = [escapeTokenContent(content, false)]
		}
	} else {
		if (isOpenTag) {
			result = [`<i></i><!-- %pcs-comment-start#${content}`]
		} else if (isCloseTag) {
			result = [wrapTrailingWhitespace(content, '%pcs-comment-end#-->')]
		} else if (isInlineHtml) {
			result = [content]
		} else {
			result = [escapeTokenContent(content, true)]
		}
	}

	return { strings: result, length: content.length }
}

function preAction(php: string): string {
	const scriptStyleRanges = getScriptStyleRanges(php)
	const strArr: string[] = []
	const tokens = parser.tokenGetAll(php)

	let index = 0

	for (const token of tokens) {
		const isInScriptStyleTag = inScriptStyleTag(scriptStyleRanges, index)
		const { strings, length } = processToken(token, isInScriptStyleTag)

		strArr.push(...strings)
		index += length
	}

	// Append closing tag if needed
	const lastToken = tokens.at(-1)
	if (typeof lastToken === 'object' && Array.isArray(lastToken)) {
		const [type] = lastToken as [string]
		if (type !== 'T_CLOSE_TAG' && type !== 'T_INLINE_HTML') {
			strArr.push('?>%pcs-comment-end#-->')
		}
	}

	return strArr.join('')
}

function afterAction(php: string): string {
	return (
		php
			// .replace(/\?>\s*%pcs-comment-end#-->\s*$/g, '')
			.replace(/%pcs-comment-end#-->/g, '')
			.replace(/<i>\s*<\/i>\s*<!-- %pcs-comment-start#/g, '')
			.replace(/-%comment-end#->/g, '-->')
			.replace(/%pcs-comment-end#\*\//g, '')
			.replace(/\/\*%pcs-comment-start#/g, '')
			.replace(/\*%comment-end#\//g, '*/')
			.replace(/pcs%quote#1/g, '"')
			.replace(/pcs%quote~2/g, "'")
	)
}

/**
 * get all script/style tag ranges
 * @param {string} php PHP code
 * @returns {[number, number | null][]} Ranges of script/style tags
 */
function getScriptStyleRanges(php: string): [number, number | null][] {
	const ranges: [number, number | null][] = []
	let start = 0
	const parser = new htmlparser.Parser(
		{
			onopentag: (name) => {
				if (name === 'script' || name === 'style') {
					start = parser.startIndex
				}
			},
			onclosetag: (name) => {
				if (name === 'script' || name === 'style') {
					ranges.push([start, parser.endIndex])
				}
			},
		},
		{
			decodeEntities: true,
		},
	)
	parser.write(php)
	parser.end()
	return ranges
}

function inScriptStyleTag(ranges: [number, number | null][], index: number) {
	for (const [start, end] of ranges) {
		if (index >= start && index <= (end ?? Number.POSITIVE_INFINITY)) {
			return true
		}
	}
	return false
}

/**
 * BeautifyOptions with camelCase keys derived from HTMLBeautifyOptions
 */
type BeautifyOptions = CamelizeKeys<HTMLBeautifyOptions> & {
	insertSpaces: boolean
	tabSize: number
}
export function beautify(text: string, options: BeautifyOptions): string {
	// if only php code, return text directly
	const indexOfPhp = text.indexOf('<?php')
	const indexOfEndPhp = text.indexOf('?>')

	const isEntirePhpCodeBlock =
		indexOfPhp > -1 &&
		indexOfPhp === text.lastIndexOf('<?php') &&
		indexOfEndPhp === text.lastIndexOf('?>') &&
		(indexOfEndPhp === -1 || indexOfEndPhp + 3 === text.length)

	if (isEntirePhpCodeBlock) {
		// Remove leading spaces before <?php
		return text.replace(/^\s+<\?php/i, '<?php')
	}

	const defaultUnformattedTags = [
		'area',
		'base',
		'br',
		'col',
		'embed',
		'hr',
		'img',
		'input',
		'keygen',
		'link',
		'menuitem',
		'meta',
		'param',
		'source',
		'track',
		'wbr',
		'!doctype',
		'?xml',
		'?php',
		'?=',
		'basefont',
		'isindex',
	]
	const htmlOptions = {
		content_unformatted: getTagsFormatOption(options, 'contentUnformatted'),
		end_with_newline: getFormatOption(options, 'endWithNewline', false),
		extra_liners: getTagsFormatOption(options, 'extraLiners'),
		indent_char: options.insertSpaces ? ' ' : '\t',
		indent_handlebars: getFormatOption(options, 'indentHandlebars', false),
		indent_inner_html: getFormatOption(options, 'indentInnerHtml', false),
		indent_size: options.insertSpaces ? options.tabSize : 1,
		max_preserve_newlines: getFormatOption(options, 'maxPreserveNewlines'),
		preserve_newlines: getFormatOption(options, 'preserveNewlines', false),
		templating: ['php'],
		unformatted: getTagsFormatOption(options, 'unformatted', defaultUnformattedTags),
		wrap_attributes: getFormatOption(options, 'wrapAttributes', 'auto'),
		wrap_line_length: getFormatOption(options, 'wrapLineLength', 120),
	} satisfies HTMLBeautifyOptions

	const php = preAction(text)
	return afterAction(beautifyHtml(php, htmlOptions))
}
