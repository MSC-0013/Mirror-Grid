import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/*.d.ts',
      '**/*.tsbuildinfo',
      '.turbo/**',
    ],
  },
  // Base TypeScript recommended rules
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.cjs', '**/*.mjs'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  // Strict Purity Boundaries for packages/sim (and packages/reliability)
  {
    files: ['packages/sim/src/**/*.ts', 'packages/reliability/src/**/*.ts'],
    ignores: ['**/*.test.ts', '**/test-harness.ts', '**/tools/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'Date',
          message:
            'Date is forbidden in packages/sim and packages/reliability: time must be injected via VirtualClock or Clock interface.',
        },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@mirrorgrid/*'],
              message:
                'packages/sim and packages/reliability must remain completely standalone with zero workspace imports.',
            },
          ],
        },
      ],
    },
  },
);
