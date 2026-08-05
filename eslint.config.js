'use strict';

const js = require('@eslint/js');
const prettier = require('eslint-config-prettier');

module.exports = [
    {
        ignores: ['node_modules/**', '*.json']
    },
    js.configs.recommended,
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: 'commonjs',
            globals: {
                require: 'readonly',
                module: 'writable',
                process: 'readonly',
                console: 'readonly',
                __dirname: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                setTimeout: 'readonly',
                URL: 'readonly'
            }
        },
        rules: {
            // The rule that would have caught the five dead module-level globals
            // and the unused `user` binding in the AFK-disconnect branch.
            'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            'no-unreachable': 'error',
            eqeqeq: ['warn', 'smart'],
            'no-var': 'error',
            'prefer-const': 'warn'
        }
    },
    // Turns off anything that would fight with prettier's formatting.
    prettier
];
