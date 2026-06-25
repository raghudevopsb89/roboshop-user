const newrelic = require('newrelic');
const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { register, metricsMiddleware } = require('./metrics');

const app = express();

function log(level, msg, extra) {
    const line = { ts: new Date().toISOString(), level, service: 'user', msg, ...extra };
    process.stdout.write(JSON.stringify(line) + '\n');
}

let reqSeq = 0;
function requestLogger(req, res, next) {
    if (req.path === '/metrics' || req.path === '/health') return next();
    const reqId = req.headers['x-request-id'] || `${process.pid}-${++reqSeq}`;
    req.reqId = reqId;
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

async function connectDB() {
    const maxRetries = 30;
    for (let i = 0; i < maxRetries; i++) {
        try {
            const client = await MongoClient.connect(MONGO_URL);
            db = client.db();
            console.log('Connected to MongoDB');
            return;
        } catch (err) {
            console.log(`MongoDB connection attempt ${i + 1}/${maxRetries} failed, retrying in 2s...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
    throw new Error('Failed to connect to MongoDB');
}

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', service: 'user' });
});

app.get('/metrics', async (req, res) => {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
});

// Register
app.post('/register', async (req, res) => {
    try {
        const { username, email, password, firstName, lastName, phone } = req.body;

        const existing = await db.collection('users').findOne({
            $or: [{ username }, { email }]
        });
        if (existing) {
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
        console.log(`User registered: ${username}`);
        res.status(201).json({ id: result.insertedId, username, email });
    } catch (err) {
        console.error('Registration error:', err.message);
        res.status(500).json({ error: 'Registration failed' });
    }
});

// Login
app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await db.collection('users').findOne({ username });

        const passwordOk = user && await newrelic.startSegment('bcrypt.compare', true, () => bcrypt.compare(password, user.password));
        if (!passwordOk) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { userId: user._id.toString(), username: user.username, email: user.email },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        console.log(`User logged in: ${username}`);
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
        console.error('Login error:', err.message);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Get profile (requires JWT)
app.get('/profile', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).json({ error: 'No token provided' });

        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await db.collection('users').findOne(
            { _id: new ObjectId(decoded.userId) },
            { projection: { password: 0 } }
        );

        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
});

// Validate user (internal service call)
app.get('/validate/:userId', async (req, res) => {
    try {
        const user = await db.collection('users').findOne(
            { _id: new ObjectId(req.params.userId) },
            { projection: { password: 0 } }
        );
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: 'Validation failed' });
    }
});

let server;
connectDB().then(() => {
    server = app.listen(PORT, () => {
        log('info', 'server.listen', { port: PORT, pid: process.pid });
    });
});

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
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (err) => {
    log('error', 'uncaughtException', { error: err.message, stack: err.stack });
});
process.on('unhandledRejection', (reason) => {
    log('error', 'unhandledRejection', { reason: String(reason) });
});
