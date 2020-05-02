module.exports = {
    extends: ['../.eslintrc.js'],
    parserOptions: {
        tsconfigRootDir: __dirname,
        project: ['./tsconfig.json'],
    },
    rules: {
        'import/no-extraneous-dependencies': 'off',
    },
};
