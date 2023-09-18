/* eslint-env node */
module.exports = {
  parser: '@typescript-eslint/parser',
  root: true,
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended-type-checked',
    'plugin:@typescript-eslint/stylistic-type-checked',
    'plugin:unicorn/recommended',
    'plugin:prettier/recommended'
  ],
  parserOptions: {
    project: true,
    tsconfigRootDir: __dirname,
    ecmaVersion: 2022,
    sourceType: 'module'
  },
  plugins: [
    'simple-import-sort',
    'import',
    '@typescript-eslint',
    'prettier',
    'unicorn'
  ],
  settings: {
    'import/resolver': {
      node: {
        extensions: ['.js', '.jsx', '.ts', '.tsx']
      }
    }
  },
  rules: {
    'prettier/prettier': 'error',
    'no-console': ['error', { allow: ['info', 'warn', 'error'] }],
    // 'import/order': 'off',
    // 'sort-imports': 'off',
    // 'simple-import-sort/imports': 'error',
    // 'simple-import-sort/exports': 'error',
    // 'import/first': 'error',
    // 'import/newline-after-import': 'error',
    // 'import/no-duplicates': 'error',
    '@typescript-eslint/no-unsafe-enum-comparison': 'off',
    // '@typescript-eslint/no-non-null-assertion': 'off',
    'unicorn/prevent-abbreviations': 'off',
    'unicorn/no-process-exit': 'off',
    'unicorn/filename-case': 'off',
    '@typescript-eslint/no-misused-promises': [
      'error',
      {
        checksVoidReturn: false
      }
    ]
  },
  overrides: [
    {
      files: ['*.js', '*.cjs'],
      extends: ['plugin:@typescript-eslint/disable-type-checked']
    }
  ]
};
