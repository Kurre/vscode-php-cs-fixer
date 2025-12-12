import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
	test: {
		environment: 'node',
		exclude: [...configDefaults.exclude],
		setupFiles: ['tests/setup/vitest.setup.ts'],
		include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
	},
})
