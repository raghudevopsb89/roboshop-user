module.exports = {
    testEnvironment: 'node',
    // newrelic is a production-only dependency and bcrypt has native bindings;
    // map both to lightweight test stubs.
    moduleNameMapper: {
        '^newrelic$': '<rootDir>/test/mocks/newrelic.js',
        '^bcrypt$': '<rootDir>/test/mocks/bcrypt.js',
    },
    silent: true,
    testMatch: ['**/*.test.js'],
    // Keep the fast unit suite independent of Docker: integration specs
    // (`*.integration.test.js`) also end in `.test.js`, so exclude them here.
    // They run via `npm run test:integration` (jest.integration.config.js).
    testPathIgnorePatterns: ['/node_modules/', '\\.integration\\.test\\.js$'],
};
