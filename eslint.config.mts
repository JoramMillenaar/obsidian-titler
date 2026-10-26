import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'test',
		'src/dev',
		'reference-obsidian-similarity',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
		'tsconfig.build.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
				__WORKER_CONTENTS_PLACEHOLDER__: 'readonly',
				__DEV__: 'readonly',
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		files: ['src/generation/worker/**/*.ts'],
		languageOptions: {
			globals: {
				...globals.worker,
			},
		},
	},
	{
		// Pure logic and everything the model worker bundles must not touch Obsidian: the worker
		// has no `obsidian` module, and tests run these files under plain Node.
		files: ['src/core/**/*.ts', 'src/generation/**/*.ts', 'src/constants.ts', 'src/types.ts'],
		rules: {
			'no-restricted-imports': ['error', {
				paths: [{name: 'obsidian', message: 'Keep this module free of Obsidian APIs (worker-bundled and unit-tested).'}],
			}],
		},
	},
	{
		// The model library belongs in the worker bundle only; main.js would otherwise carry it twice.
		files: ['src/**/*.ts'],
		ignores: ['src/generation/worker/**/*.ts'],
		rules: {
			'@typescript-eslint/no-restricted-imports': ['error', {
				paths: [{name: '@huggingface/transformers', message: 'Only the model worker may import transformers.js.', allowTypeImports: true}],
			}],
		},
	},
);
