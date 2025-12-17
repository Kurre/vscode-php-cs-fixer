import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const url = 'https://cs.symfony.com/download/php-cs-fixer-v3.phar'

export async function downloadPhpCsFixerFile(outputPath: string): Promise<void> {
	try {
		console.log('start to download php-cs-fixer.phar')

		const response = await fetch(url)

		if (!response.ok) {
			throw new Error(`Failed to download: ${response.status} ${response.statusText}`)
		}

		const buffer = await response.arrayBuffer()
		await fs.writeFile(outputPath, new Uint8Array(buffer))

		console.log('download php-cs-fixer.phar successfully.')
	} catch (err) {
		await fs.unlink(outputPath) // Delete the file on error
		throw err
	}
}

// If ran from terminal, execute the function
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const outputPath = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'bin', 'php-cs-fixer.phar')
	console.log('🚀 ~ outputPath:', outputPath)
	downloadPhpCsFixerFile(outputPath).catch(console.error)
}
