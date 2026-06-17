const client = require('prom-client');

const register = new client.Registry();
register.setDefaultLabels({ service: 'user' });
client.collectDefaultMetrics({ register });

const httpRequestDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    registers: [register],
});

const httpRequestsTotal = new client.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code'],
    registers: [register],
});

function metricsMiddleware(req, res, next) {
    if (req.path === '/metrics') {
        return next();
    }

    const end = httpRequestDuration.startTimer();
    res.on('finish', () => {
        const route = req.route ? req.route.path : req.path;
        const labels = { method: req.method, route, status_code: res.statusCode };
        end(labels);
        httpRequestsTotal.inc(labels);
    });
    next();
}

module.exports = { register, metricsMiddleware };
