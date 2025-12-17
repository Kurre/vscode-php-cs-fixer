import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

const slowEnabled = process.env.RUN_SLOW === '1'

describe.skipIf(!slowEnabled)('Slow php-cs-fixer e2e (optional)', () => {
	it('runs real php-cs-fixer binary for plumbing checks', async () => {
		const bin = process.env.PHP_CS_FIXER_BIN
		if (!bin) {
			throw new Error('PHP_CS_FIXER_BIN not set')
		}

		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pcf-slow-'))
		const file = path.join(tmpDir, 'test.php')
		fs.writeFileSync(file, '<?php echo "test";')

		const { stdout } = await execFileAsync(bin, ['fix', '--dry-run', '--format=json', file], {
			cwd: tmpDir,
		})

		const parsed = JSON.parse(stdout)
		expect(parsed).toHaveProperty('files')
	})
})
