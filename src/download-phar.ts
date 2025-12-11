import fs from 'node:fs'
import path from 'node:path'

const url = 'https://cs.symfony.com/download/php-cs-fixer-v3.phar'
const fileName = 'php-cs-fixer.phar'
const outputPath = path.join(path.dirname(new URL(import.meta.url).pathname), '..', fileName)

async function downloadFile(): Promise<void> {
	try {
		console.log('start to download php-cs-fixer.phar')

		const response = await fetch(url)

		if (!response.ok) {
			throw new Error(`Failed to download: ${response.status} ${response.statusText}`)
		}

		const buffer = await response.arrayBuffer()
		fs.writeFileSync(outputPath, new Uint8Array(buffer))

		console.log('download php-cs-fixer.phar successfully.')
	} catch (err) {
		fs.unlink(outputPath, () => {}) // Delete the file on error
		throw err
	}
}

downloadFile().catch((err) => {
	console.error('Failed to download php-cs-fixer.phar:', err)
	process.exit(1)
})
