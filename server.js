const express = require('express');
const cors = require('cors');
const { MongoClient, ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
app.use(cors());
app.use(express.json());

const MONGO_URL = process.env.MONGO_URL || 'mongodb://mongodb:27017/users';
const JWT_SECRET = process.env.JWT_SECRET || 'roboshop-secret-key';
const PORT = process.env.PORT || 8001;

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

        const hashedPassword = await bcrypt.hash(password, 10);
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

        if (!user || !(await bcrypt.compare(password, user.password))) {
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

connectDB().then(() => {
    app.listen(PORT, () => {
        console.log(`User service listening on port ${PORT}`);
    });
});
