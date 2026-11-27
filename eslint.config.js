// ESLint flat config: recommended correctness rules plus maintainability limits and JSDoc checks.
import js from "@eslint/js";
import globals from "globals";
import jsdoc from "eslint-plugin-jsdoc";

export default [
  { ignores: ["node_modules/", "artifacts/", "coverage/"] },
  js.configs.recommended,
  jsdoc.configs["flat/recommended-typescript-flavor"],
  {
    files: ["**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      // Correctness & clarity
      eqeqeq: ["error", "always"],
      "no-var": "error",
      "prefer-const": "error",
      "no-shadow": "error",
      "no-implicit-coercion": ["error", { allow: ["!!"] }],
      "no-nested-ternary": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "object-shorthand": "error",
      "prefer-template": "error",
      curly: ["error", "multi-line"],
      // Maintainability budgets
      complexity: ["error", 14],
      "max-depth": ["error", 3],
      "max-params": ["error", 4],
      "max-lines-per-function": ["error", { max: 70, skipBlankLines: true, skipComments: true }],
      "max-lines": ["error", { max: 450, skipBlankLines: true, skipComments: true }],
      // JSDoc: document every exported API; types are checked by `tsc --checkJs`.
      "jsdoc/require-jsdoc": [
        "error",
        { publicOnly: true, require: { FunctionDeclaration: true } },
      ],
      "jsdoc/require-param-description": "off",
      "jsdoc/require-returns-description": "off",
      "jsdoc/require-property-description": "off",
      "jsdoc/require-returns": "off",
      "jsdoc/require-param": "off",
      "jsdoc/tag-lines": "off",
      "jsdoc/reject-any-type": "error",
    },
  },
  {
    files: ["public/**/*.js"],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ["test/**/*.mjs"],
    rules: {
      "max-lines-per-function": "off",
      "max-lines": "off",
      "jsdoc/require-jsdoc": "off",
    },
  },
];
