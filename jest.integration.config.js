module.exports = {
    testEnvironment: 'node',
    // newrelic is a production-only dependency; map it to an inert stub so the
    // agent never loads during tests. bcrypt/jwt/mongodb run FOR REAL against
    // the throwaway container — that is the point of component integration.
    moduleNameMapper: {
        '^newrelic$': '<rootDir>/test/mocks/newrelic.js',
    },
    silent: true,
    testMatch: ['**/*.integration.test.js'],
    // Container startup (image pull + boot + connect) can be slow.
    testTimeout: 120000,
};
