import { commands, Range, type TextDocumentChangeEvent, window } from 'vscode'

import type { FormattingService } from './formattingService'

export class AutoFixService {
	constructor(private readonly formatting: FormattingService) {}

	async doAutoFixByBracket(event: TextDocumentChangeEvent) {
		if (event.contentChanges.length === 0) return

		const pressedKey = event.contentChanges[0]?.text
		if (pressedKey && !/^\s*\}$/.test(pressedKey)) {
			return
		}

		const editor = window.activeTextEditor
		if (!editor) return

		const document = editor.document
		const originalStart = editor.selection.start

		await commands.executeCommand('editor.action.jumpToBracket')
		let start = editor.selection.start
		const offsetStart0 = document.offsetAt(originalStart)
		const offsetStart1 = document.offsetAt(start)
		if (offsetStart0 === offsetStart1) {
			return
		}

		const nextChar = document.getText(new Range(start, start.translate(0, 1)))
		if (offsetStart0 - offsetStart1 < 3 || nextChar !== '{') {
			await commands.executeCommand('cursorUndo')
			return
		}

		let line = document.lineAt(start)
		let code = '<?php\n$__pcf__spliter=0;\n'
		let dealFun = (fixed: string) =>
			fixed.replace(/^<\?php[\s\S]+?\$__pcf__spliter\s*=\s*0;\r?\n/, '').replace(/\s*$/, '')
		let searchIndex = -1
		if (/^\s*\{\s*$/.test(line.text)) {
			const preline = document.lineAt(line.lineNumber - 1)
			searchIndex = preline.text.search(
				/((if|for|foreach|while|switch|^\s*function\s+\w+|^\s*function\s*)\s*\(.+?\)|(class|trait|interface)\s+[\w ]+|do|try)\s*$/i,
			)
			if (searchIndex > -1) {
				line = preline
			}
		} else {
			searchIndex = line.text.search(
				/((if|for|foreach|while|switch|^\s*function\s+\w+|^\s*function\s*)\s*\(.+?\)|(class|trait|interface)\s+[\w ]+|do|try)\s*\{\s*$/i,
			)
		}

		if (searchIndex > -1) {
			start = line.range.start
		} else {
			code += `${line.text.match(/^(\s*)\S+/)?.[1]}if(1)`
			dealFun = (fixed: string) => {
				const match = fixed.match(
					/^<\?php[\s\S]+?\$__pcf__spliter\s*=\s*0;\s+?if\s*\(\s*1\s*\)\s*(\{[\s\S]+?\})\s*$/i,
				)?.[1]
				return match ?? ''
			}
		}

		await commands.executeCommand('cursorUndo')
		const end = editor.selection.start
		const range = new Range(start, end)
		const originalText = code + document.getText(range)

		try {
			const tmpDirRef = { value: '' }
			const text = await this.formatting.format(originalText, event.document.uri, () => {}, {
				isPartial: true,
				isDiff: false,
				tmpDirRef,
			})
			const fixedText = dealFun(text)
			if (fixedText !== dealFun(originalText)) {
				await editor.edit((builder) => {
					builder.replace(range, text)
				})
				if (editor.selections.length > 0) {
					await commands.executeCommand('cancelSelection')
				}
			}
		} catch (err) {
			console.log(err)
		}
	}

	async doAutoFixBySemicolon(event: TextDocumentChangeEvent) {
		if (event.contentChanges.length === 0) return

		const pressedKey = event.contentChanges[0]?.text
		if (pressedKey !== ';') {
			return
		}

		const editor = window.activeTextEditor
		if (!editor) return

		const line = editor.document.lineAt(editor.selection.start)
		if (line.text.length < 5) {
			return
		}

		if (line.range.end.character !== editor.selection.end.character + 1) {
			return
		}

		const indent = line.text.match(/^(\s*)/)?.[1]
		const dealFun = (fixed: string) => {
			return fixed.replace(/^<\?php[\s\S]+?\$__pcf__spliter\s*=\s*0;\r?\n/, '').replace(/\s+$/, '')
		}

		const range = line.range
		const originalText = `<?php\n$__pcf__spliter=0;\n${line.text}`

		try {
			const tmpDirRef = { value: '' }
			const text = await this.formatting.format(originalText, event.document.uri, () => {}, {
				isPartial: true,
				isDiff: false,
				tmpDirRef,
			})
			const fixedText = dealFun(text)
			if (fixedText !== dealFun(originalText)) {
				await editor.edit((builder) => {
					builder.replace(range, indent + fixedText)
				})
				if (editor.selections.length > 0) {
					await commands.executeCommand('cancelSelection')
				}
			}
		} catch (err) {
			console.log(err)
		}
	}
}
