// Component integration test for the user service.
//
// Spins up a REAL MongoDB (the service's own backing store) in a throwaway
// Testcontainers container and drives the exported Express app with supertest.
// bcrypt hashing and JWT signing/verification run FOR REAL — nothing is mocked,
// because Mongo/bcrypt/jwt are all this service's own dependencies.

// Disable the Testcontainers Ryuk reaper: this suite stops its own container in
// afterAll, and the ryuk image is not needed/available in every environment.
process.env.TESTCONTAINERS_RYUK_DISABLED = 'true';

const request = require('supertest');
const { GenericContainer } = require('testcontainers');
const { MongoClient } = require('mongodb');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const JWT_SECRET = 'integration-test-secret';

let container;
let app;
let connectDB;
let closeDB;
let inspectClient; // separate client used only to assert persisted state
let db;

const baseUser = {
    username: 'alice',
    email: 'alice@example.com',
    password: 's3cret-pass',
    firstName: 'Alice',
    lastName: 'Smith',
    phone: '555-0100',
};

beforeAll(async () => {
    container = await new GenericContainer('mongo:7')
        .withExposedPorts(27017)
        .start();

    const url = `mongodb://${container.getHost()}:${container.getMappedPort(27017)}/users`;

    // Env MUST be set before requiring the app (MONGO_URL and JWT_SECRET are
    // read at module load time).
    process.env.MONGO_URL = url;
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.BCRYPT_COST = '4'; // real hashing, low cost to keep tests fast

    ({ app, connectDB, closeDB } = require('./server'));
    await connectDB();

    // Independent connection so assertions read what the app actually wrote.
    inspectClient = await MongoClient.connect(url);
    db = inspectClient.db();
});

afterAll(async () => {
    if (inspectClient) await inspectClient.close();
    if (closeDB) await closeDB(); // close the app's own Mongo client so Jest exits cleanly
    if (container) await container.stop();
});

beforeEach(async () => {
    await db.collection('users').deleteMany({});
});

async function registerBase(overrides = {}) {
    return request(app).post('/register').send({ ...baseUser, ...overrides });
}

describe('user component integration (real MongoDB)', () => {
    it('registers a user and persists a bcrypt-hashed (never plaintext) password', async () => {
        const res = await registerBase();
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({ username: 'alice', email: 'alice@example.com' });

        const doc = await db.collection('users').findOne({ username: 'alice' });
        expect(doc).toBeTruthy();
        expect(doc.password).not.toBe(baseUser.password);
        expect(doc.password).toMatch(/^\$2[aby]\$/); // bcrypt hash signature
        // The stored hash really verifies against the plaintext.
        expect(await bcrypt.compare(baseUser.password, doc.password)).toBe(true);
    });

    it('rejects a duplicate username or email with 400 (real $or findOne)', async () => {
        await registerBase();

        const dupUsername = await registerBase({ email: 'other@example.com' });
        expect(dupUsername.status).toBe(400);
        expect(dupUsername.body).toEqual({ error: 'Username or email already exists' });

        const dupEmail = await registerBase({ username: 'bob' });
        expect(dupEmail.status).toBe(400);

        // Only the original user was ever persisted.
        expect(await db.collection('users').countDocuments()).toBe(1);
    });

    it('logs in with correct credentials and returns a valid JWT with no password', async () => {
        await registerBase();

        const res = await request(app)
            .post('/login')
            .send({ username: 'alice', password: baseUser.password });
        expect(res.status).toBe(200);
        expect(res.body.token).toBeTruthy();
        expect(res.body.user).not.toHaveProperty('password');

        // Token was signed with the real secret and carries the right claims.
        const decoded = jwt.verify(res.body.token, JWT_SECRET);
        expect(decoded.username).toBe('alice');
        expect(decoded.email).toBe('alice@example.com');
        expect(decoded.userId).toBeTruthy();
    });

    it('rejects login with a wrong password (401, real bcrypt.compare)', async () => {
        await registerBase();

        const res = await request(app)
            .post('/login')
            .send({ username: 'alice', password: 'wrong-password' });
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ error: 'Invalid credentials' });
    });

    it('validates a user by id and returns the stored record without password', async () => {
        const reg = await registerBase();
        const userId = reg.body.id;

        const res = await request(app).get(`/validate/${userId}`);
        expect(res.status).toBe(200);
        expect(res.body.username).toBe('alice');
        expect(res.body.email).toBe('alice@example.com');
        expect(res.body).not.toHaveProperty('password');
    });

    it('returns the profile for a request bearing the issued JWT', async () => {
        await registerBase();
        const login = await request(app)
            .post('/login')
            .send({ username: 'alice', password: baseUser.password });
        const token = login.body.token;

        const res = await request(app)
            .get('/profile')
            .set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
        expect(res.body.username).toBe('alice');
        expect(res.body).not.toHaveProperty('password');
    });
});
