import globals from 'globals'
import tseslint from 'typescript-eslint'

export default [
  { files: ['**/*.js'], languageOptions: { sourceType: 'script' } },
  { languageOptions: { globals: globals.browser } },
  ...tseslint.configs.recommended,
  {
    rules: {
      'semi': ['error', 'never'],
      'no-unexpected-multiline': 'error',
      'quotes': ['error', 'single'],
    },
  },
]
