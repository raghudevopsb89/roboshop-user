const newrelic = require('newrelic');
const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { register, metricsMiddleware } = require('./metrics');

const SERVICE = 'user';

for (const stream of [process.stdout, process.stderr]) {
    if (stream._handle && typeof stream._handle.setBlocking === 'function') {
        stream._handle.setBlocking(true);
    }
}

function log(level, msg, extra) {
    const line = { ts: new Date().toISOString(), level, service: SERVICE, msg, ...(extra || {}) };
    try {
        process.stdout.write(JSON.stringify(line) + '\n');
    } catch (_) {
        // last-ditch — never let logging throw
    }
}

const _origConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
function stringifyArg(a) {
    if (a instanceof Error) return a.stack || a.message;
    if (typeof a === 'object' && a !== null) {
        try { return JSON.stringify(a); } catch (_) { return String(a); }
    }
    return String(a);
}
for (const [name, level] of [['log', 'info'], ['info', 'info'], ['warn', 'warn'], ['error', 'error'], ['debug', 'debug']]) {
    console[name] = (...args) => log(level, args.map(stringifyArg).join(' '), { source: 'console' });
}

const app = express();

let reqSeq = 0;
function requestLogger(req, res, next) {
    if (req.path === '/metrics' || req.path === '/health') return next();
    const reqId = req.headers['x-request-id'] || `${process.pid}-${++reqSeq}`;
    req.reqId = reqId;
    res.setHeader('x-request-id', reqId);
    const start = process.hrtime.bigint();
    log('info', 'req.start', { reqId, method: req.method, path: req.path, remote: req.ip });

    let settled = false;
    const finish = (event) => {
        if (settled) return;
        settled = true;
        const durMs = Number(process.hrtime.bigint() - start) / 1e6;
        log('info', `req.${event}`, { reqId, method: req.method, path: req.path, status: res.statusCode, durMs: +durMs.toFixed(1) });
    };
    res.on('finish', () => finish('finish'));
    res.on('close', () => finish(res.writableEnded ? 'finish' : 'close'));
    req.on('aborted', () => log('warn', 'req.aborted', { reqId, method: req.method, path: req.path }));
    next();
}

app.use(cors());
app.use(express.json());
app.use(requestLogger);
app.use(metricsMiddleware);

const MONGO_URL = process.env.MONGO_URL || 'mongodb://mongodb:27017/users';
const JWT_SECRET = process.env.JWT_SECRET || 'roboshop-secret-key';
const PORT = process.env.PORT || 8001;
const BCRYPT_COST = parseInt(process.env.BCRYPT_COST || '8', 10);

let db;
let mongoClient;

async function connectDB() {
    const maxRetries = 30;
    for (let i = 0; i < maxRetries; i++) {
        try {
            mongoClient = await MongoClient.connect(MONGO_URL);
            db = mongoClient.db();
            log('info', 'mongo.connected', { url: MONGO_URL });
            return;
        } catch (err) {
            log('warn', 'mongo.connect.retry', { attempt: i + 1, error: err.message });
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    throw new Error('Failed to connect to MongoDB');
}

async function closeDB() {
    if (mongoClient) {
        await mongoClient.close();
        mongoClient = undefined;
    }
}

app.get('/health', (req, res) => {
    res.json({ status: 'OK', service: SERVICE });
});

app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
});

app.post('/register', async (req, res) => {
    try {
        const { username, email, password, firstName, lastName, phone } = req.body;

        const existing = await db.collection('users').findOne({
            $or: [{ username }, { email }]
        });
        if (existing) {
            log('warn', 'register.conflict', { reqId: req.reqId, username, email });
            return res.status(400).json({ error: 'Username or email already exists' });
        }

        const hashedPassword = await newrelic.startSegment('bcrypt.hash', true, () => bcrypt.hash(password, BCRYPT_COST));
        const user = {
            username,
            email,
            password: hashedPassword,
            firstName: firstName || '',
            lastName: lastName || '',
            phone: phone || '',
            createdAt: new Date()
        };

        const result = await db.collection('users').insertOne(user);
        log('info', 'user.registered', { reqId: req.reqId, userId: String(result.insertedId), username });
        res.status(201).json({ id: result.insertedId, username, email });
    } catch (err) {
        log('error', 'register.failed', { reqId: req.reqId, error: err.message, stack: err.stack });
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await db.collection('users').findOne({ username });

        const passwordOk = user && await newrelic.startSegment('bcrypt.compare', true, () => bcrypt.compare(password, user.password));
        if (!passwordOk) {
            log('warn', 'login.invalid', { reqId: req.reqId, username });
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { userId: user._id.toString(), username: user.username, email: user.email },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        log('info', 'user.login', { reqId: req.reqId, userId: String(user._id), username });
        res.json({
            token,
            user: {
                id: user._id,
                username: user.username,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName
            }
        });
    } catch (err) {
        log('error', 'login.failed', { reqId: req.reqId, error: err.message, stack: err.stack });
        res.status(500).json({ error: 'Login failed' });
    }
});

app.get('/profile', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) {
            log('warn', 'profile.no_token', { reqId: req.reqId });
            return res.status(401).json({ error: 'No token provided' });
        }

        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await db.collection('users').findOne(
            { _id: new ObjectId(decoded.userId) },
            { projection: { password: 0 } }
        );

        if (!user) {
            log('warn', 'profile.not_found', { reqId: req.reqId, userId: decoded.userId });
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
    } catch (err) {
        log('warn', 'profile.invalid_token', { reqId: req.reqId, error: err.message });
        res.status(401).json({ error: 'Invalid token' });
    }
});

app.get('/validate/:userId', async (req, res) => {
    try {
        const user = await db.collection('users').findOne(
            { _id: new ObjectId(req.params.userId) },
            { projection: { password: 0 } }
        );
        if (!user) {
            log('warn', 'validate.not_found', { reqId: req.reqId, userId: req.params.userId });
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(user);
    } catch (err) {
        log('error', 'validate.failed', { reqId: req.reqId, userId: req.params.userId, error: err.message });
        res.status(500).json({ error: 'Validation failed' });
    }
});

let server;
const LISTEN_BACKLOG = parseInt(process.env.LISTEN_BACKLOG || '2048', 10);

function shutdown(signal) {
    log('warn', 'server.shutdown.start', { signal });
    if (!server) return process.exit(0);
    server.close((err) => {
        log(err ? 'error' : 'info', 'server.shutdown.done', { signal, error: err && err.message });
        process.exit(err ? 1 : 0);
    });
    setTimeout(() => {
        log('error', 'server.shutdown.forced', { signal });
        process.exit(1);
    }, 25000).unref();
}

// Only start the server / connect to infra when run directly (node server.js).
// When required by tests, export the app and helpers so supertest can drive it.
if (require.main === module) {
    connectDB().then(() => {
        server = app.listen(PORT, LISTEN_BACKLOG, () => {
            log('info', 'server.listen', { port: PORT, pid: process.pid, backlog: LISTEN_BACKLOG });
        });
        server.keepAliveTimeout = 65000;
        server.headersTimeout = 70000;
    }).catch((err) => {
        log('error', 'server.startup.failed', { error: err.message });
        process.exit(1);
    });

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('uncaughtException', (err) => {
        log('error', 'uncaughtException', { error: err.message, stack: err.stack });
    });
    process.on('unhandledRejection', (reason) => {
        log('error', 'unhandledRejection', { reason: String(reason) });
    });
}

module.exports = { app, connectDB, closeDB };

///