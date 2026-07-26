import js from '@eslint/js'
import boundaries from 'eslint-plugin-boundaries'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'
import tseslint from 'typescript-eslint'
import globals from 'globals'

/**
 * Luật ranh giới (Architecture.md §3) là lý do chọn ESLint thay vì Biome.
 * Không có nó thì "module hoá" chỉ còn là tên thư mục.
 */
export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage', 'out', 'renders', 'assets', 'scripts'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      boundaries,
    },
    settings: {
      // Không có resolver thì alias `@/...` không quy về được file, và luật ranh giới
      // sẽ im lặng cho qua mọi thứ — đúng loại lỗi im lặng dự án này đã gặp bốn lần.
      'import/resolver': {
        typescript: { project: './tsconfig.app.json' },
      },
      'boundaries/elements': [
        { type: 'app', pattern: 'src/app/**' },
        { type: 'feature', pattern: 'src/features/*/**', capture: ['feature'] },
        { type: 'entity', pattern: 'src/entities/*/**', capture: ['entity'] },
        // `api` phải đứng TRƯỚC `shared`: cùng nằm trong src/shared nên element nào
        // khớp trước sẽ thắng. Đảo thứ tự là api bị coi là shared và mất ngoại lệ.
        { type: 'api', pattern: 'src/shared/api/**' },
        { type: 'shared', pattern: 'src/shared/**' },
        { type: 'server', pattern: 'src/server/**' },
      ],
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',

      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            // Shell được ráp mọi thứ lại.
            {
              from: { element: { type: 'app' } },
              allow: {
                to: {
                  element: {
                    types: { anyOf: ['app', 'feature', 'entity', 'shared', 'api', 'server'] },
                  },
                },
              },
            },

            // Feature KHÔNG được import feature khác. Muốn dùng chung -> đẩy xuống
            // entities hoặc shared. Capture `feature` phải trùng chính nó, nên import
            // trong cùng một feature vẫn hợp lệ.
            {
              from: { element: { type: 'feature' } },
              allow: {
                to: {
                  element: {
                    type: 'feature',
                    captured: { feature: '{{from.element.feature}}' },
                  },
                },
              },
            },
            {
              from: { element: { type: 'feature' } },
              allow: { to: { element: { types: { anyOf: ['entity', 'shared', 'api'] } } } },
            },

            // Entity là lõi thuần, chỉ được dựa vào shared và entity khác.
            {
              from: { element: { type: 'entity' } },
              allow: { to: { element: { types: { anyOf: ['entity', 'shared'] } } } },
            },

            // `shared/api` là NGOẠI LỆ DUY NHẤT được biết tới server: client tRPC phải
            // lấy type của router để có type end-to-end. Tách thành element riêng để
            // ngoại lệ này là một dòng đọc được, không phải một lỗ trong luật.
            {
              from: { element: { type: 'api' } },
              allow: {
                to: { element: { types: { anyOf: ['api', 'server', 'entity', 'shared'] } } },
              },
            },

            // Shared là đáy — không được biết gì về tầng trên.
            {
              from: { element: { type: 'shared' } },
              allow: { to: { element: { type: 'shared' } } },
            },

            // Server dùng entity/shared, không chạm vào UI feature.
            {
              from: { element: { type: 'server' } },
              allow: {
                to: { element: { types: { anyOf: ['server', 'entity', 'shared'] } } },
              },
            },
          ],
        },
      ],
    },
  },

  {
    // Script Node thuần (worker giả trong test) — cần globals của Node.
    files: ['**/*.mjs', '**/*.cjs'],
    languageOptions: { globals: { ...globals.node } },
  },

  {
    files: ['**/*.test.{ts,tsx}', 'vitest.setup.ts'],
    rules: { 'boundaries/dependencies': 'off' },
  },

  prettier,
)
