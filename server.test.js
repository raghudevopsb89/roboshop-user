const request = require('supertest');

// ---- Mock mongodb: an in-memory users collection + a minimal ObjectId. ----
jest.mock('mongodb', () => {
    let idCounter = 0;
    class ObjectId {
        constructor(id) {
            this._id = id !== undefined && id !== null ? String(id) : `oid${++idCounter}`;
        }
        toString() { return this._id; }
        toJSON() { return this._id; }
        equals(other) { return String(other) === this._id; }
    }

    const store = [];

    function matchDoc(doc, query) {
        if (query.$or) return query.$or.some((sub) => matchDoc(doc, sub));
        return Object.keys(query).every((key) => {
            if (key === '_id') return String(doc._id) === String(query._id);
            return doc[key] === query[key];
        });
    }

    function project(doc, projection) {
        if (projection && projection.password === 0) {
            const { password, ...rest } = doc;
            return rest;
        }
        return doc;
    }

    const collection = {
        findOne: async (query, options) => {
            const doc = store.find((d) => matchDoc(d, query));
            return doc ? project(doc, options && options.projection) : null;
        },
        insertOne: async (doc) => {
            const _id = new ObjectId();
            store.push({ _id, ...doc });
            return { insertedId: _id };
        },
    };

    const client = {
        db: () => ({ collection: () => collection }),
        close: async () => {},
    };

    return {
        MongoClient: { connect: async () => client },
        ObjectId,
        __store: store,
        __reset: () => { store.length = 0; },
    };
});

// jsonwebtoken is real (deterministic, no infra); newrelic + bcrypt are mapped
// to stubs via jest.config moduleNameMapper.
const mongodb = require('mongodb');
const { app, connectDB } = require('./server');

beforeAll(async () => {
    await connectDB();
});

beforeEach(() => {
    mongodb.__reset();
});

describe('GET /health', () => {
    it('returns OK status and service name', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ status: 'OK', service: 'user' });
    });
});

describe('POST /register', () => {
    it('hashes the password, stores the user and returns 201', async () => {
        const res = await request(app)
            .post('/register')
            .send({ username: 'alice', email: 'alice@example.com', password: 'secret' });
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ username: 'alice', email: 'alice@example.com' });
        expect(res.body.id).toBeDefined();
        // Password stored hashed (via bcrypt stub), never in plaintext.
        expect(mongodb.__store[0].password).toBe('hashed:secret');
    });

    it('returns 400 when username or email already exists', async () => {
        await request(app)
            .post('/register')
            .send({ username: 'bob', email: 'bob@example.com', password: 'pw' });
        const res = await request(app)
            .post('/register')
            .send({ username: 'bob', email: 'bob@example.com', password: 'pw2' });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ error: 'Username or email already exists' });
    });
});

describe('POST /login', () => {
    beforeEach(async () => {
        await request(app)
            .post('/register')
            .send({ username: 'carol', email: 'carol@example.com', password: 'topsecret', firstName: 'Carol' });
    });

    it('returns a token and user on valid credentials', async () => {
        const res = await request(app)
            .post('/login')
            .send({ username: 'carol', password: 'topsecret' });
        expect(res.status).toBe(200);
        expect(typeof res.body.token).toBe('string');
        expect(res.body.user).toMatchObject({ username: 'carol', email: 'carol@example.com' });
        expect(res.body.user.password).toBeUndefined();
    });

    it('returns 401 on wrong password', async () => {
        const res = await request(app)
            .post('/login')
            .send({ username: 'carol', password: 'wrong' });
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: 'Invalid credentials' });
    });

    it('returns 401 for an unknown user', async () => {
        const res = await request(app)
            .post('/login')
            .send({ username: 'ghost', password: 'whatever' });
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: 'Invalid credentials' });
    });
});

describe('GET /validate/:userId', () => {
    it('returns the user (without password) when found', async () => {
        const reg = await request(app)
            .post('/register')
            .send({ username: 'dave', email: 'dave@example.com', password: 'pw' });
        const res = await request(app).get(`/validate/${reg.body.id}`);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ username: 'dave', email: 'dave@example.com' });
        expect(res.body.password).toBeUndefined();
    });

    it('returns 404 for an unknown user', async () => {
        const res = await request(app).get('/validate/nonexistent');
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ error: 'User not found' });
    });
});

describe('GET /profile', () => {
    it('returns 401 when no token is provided', async () => {
        const res = await request(app).get('/profile');
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: 'No token provided' });
    });

    it('returns the profile for a valid token', async () => {
        await request(app)
            .post('/register')
            .send({ username: 'erin', email: 'erin@example.com', password: 'pw' });
        const login = await request(app)
            .post('/login')
            .send({ username: 'erin', password: 'pw' });
        const res = await request(app)
            .get('/profile')
            .set('Authorization', `Bearer ${login.body.token}`);
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ username: 'erin', email: 'erin@example.com' });
        expect(res.body.password).toBeUndefined();
    });
});
