import globals from "globals";
import tseslint from "typescript-eslint";


export default [
  { files: ["**/*.js"], languageOptions: { sourceType: "script" } },
  { languageOptions: { globals: globals.browser } },
  ...tseslint.configs.recommended,
];
