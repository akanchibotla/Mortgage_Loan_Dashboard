// ESLint flat config.
//
// WHY this exists: `package.json` advertised `npm run lint` -> `eslint .` for
// months with NO config file on disk, so the command could only ever fail with
// "couldn't find an eslint.config.js". An advertised gate that cannot run is
// worse than no gate: it reads as covered in review and catches nothing. The
// five eslint devDependencies were already installed, so this wires them up.
//
// Scope is deliberately narrow — `src/` only. `scripts/` is Python plus one
// one-shot `.mjs` generator that CI never runs, and linting build output or
// vendored code produces noise nobody will act on.
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    // Flat config's global ignore block. `dist/` is build output and
    // `node_modules/` is vendored; both would drown any real finding.
    ignores: ['dist/**', 'node_modules/**', 'scripts/**', 'public/**'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      // Not the type-checked preset: that needs a `parserOptions.project`
      // wired to the two tsconfig references, and `npm run typecheck`
      // (`tsc -b --noEmit`) already covers type errors. This layer is for
      // the lint-only rules tsc does not have.
      tseslint.configs.recommended,
      // `.configs.flat[...]`, not `.configs[...]` — the top-level key is still
      // the eslintrc shape (`plugins` as an array of strings) and flat config
      // rejects it outright.
      reactHooks.configs.flat['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    rules: {
      // The React Compiler rule set below ships ON in eslint-plugin-react-hooks
      // v7's presets, but `babel-plugin-react-compiler` is NOT installed here —
      // Vite compiles this app without it. So these diagnostics describe code
      // the compiler *would* refuse to optimize, not anything that misbehaves
      // at runtime today. Demoted to warnings so they stay visible without
      // failing a gate over a hypothetical build. `rules-of-hooks` and
      // `exhaustive-deps` keep their preset severity: those are real bugs.
      'react-hooks/static-components': 'warn',
      'react-hooks/use-memo': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/set-state-in-render': 'warn',
      'react-hooks/error-boundaries': 'warn',
      'react-hooks/globals': 'warn',
      'react-hooks/config': 'warn',
      'react-hooks/gating': 'warn',

      // Fires on `src/lib/useCalculator.tsx`, `useChartToggles.tsx` and
      // `useTheme.tsx` — each exports a context Provider component *and* its
      // companion hook from one file, which defeats Vite's Fast Refresh for
      // that module. That is a dev-server ergonomics cost only; the production
      // bundle is unaffected. The fix is splitting each file in two, which is
      // a refactor this repo is not taking on. Kept visible as a warning
      // rather than failing the gate over a hot-reload nicety.
      'react-refresh/only-export-components': 'warn',
    },
  },
  {
    // Vitest specs run in Node and use its globals.
    files: ['src/**/__tests__/**/*.{ts,tsx}', 'src/**/*.test.{ts,tsx}'],
    languageOptions: { globals: globals.node },
  },
)
