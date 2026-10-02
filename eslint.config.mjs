import js from '@eslint/js';

export default [
    {
        // app/vendor/ son dependencias de terceros copiadas tal cual: no se
        // revisan con las reglas del proyecto (ni se corrigen a mano).
        ignores: ['node_modules/**', '.firebase/**', 'app/vendor/**']
    },
    js.configs.recommended,
    {
        // Codigo de navegador (la app es vanilla JS sin bundler)
        files: ['app/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: {
                window: 'readonly',
                document: 'readonly',
                navigator: 'readonly',
                localStorage: 'readonly',
                location: 'readonly',
                console: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                fetch: 'readonly',
                caches: 'readonly',
                self: 'readonly',
                Image: 'readonly',
                FileReader: 'readonly',
                Blob: 'readonly',
                File: 'readonly',
                FormData: 'readonly',
                Intl: 'readonly',
                URLSearchParams: 'readonly',
                URL: 'readonly',
                devicePixelRatio: 'readonly',
                CustomEvent: 'readonly',
                firebase: 'readonly',
                Swal: 'readonly'
            }
        },
        rules: {
            'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_?e' }],
            'no-undef': 'error',
            eqeqeq: ['error', 'smart'],
            'no-var': 'error',
            'prefer-const': 'warn'
        }
    },
    {
        // El service worker tiene su propio conjunto de globales
        files: ['app/sw.js'],
        languageOptions: {
            globals: {
                self: 'readonly',
                caches: 'readonly',
                clients: 'readonly',
                fetch: 'readonly',
                Request: 'readonly',
                Response: 'readonly',
                URL: 'readonly',
                console: 'readonly',
                Promise: 'readonly'
            }
        }
    },
    {
        // Herramientas y tests corren en Node
        files: ['tools/**/*.mjs', 'tests/**/*.mjs', '*.mjs'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                process: 'readonly',
                console: 'readonly',
                URL: 'readonly',
                setTimeout: 'readonly',
                Buffer: 'readonly'
            }
        },
        rules: {
            'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }]
        }
    }
];
