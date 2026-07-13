// Test mock for the newrelic agent. server.js wraps bcrypt calls in
// newrelic.startSegment(name, record, handler); the stub simply invokes the
// handler and returns its result so the wrapped work still runs.
module.exports = {
    startSegment: (name, record, handler) => handler(),
    startBackgroundTransaction: (name, handler) => handler(),
    getTransaction: () => ({ end: () => {} }),
    noticeError: () => {},
    addCustomAttribute: () => {},
};
