// Deterministic bcrypt stub for unit tests. A "hash" is just a reversible
// prefix so compare() can be verified without native bindings.
module.exports = {
    hash: async (password, cost) => `hashed:${password}`,
    compare: async (password, hashed) => hashed === `hashed:${password}`,
};
