// Load via: mongosh --host <host> < db/master-data.js
db = db.getSiblingDB('users');

db.users.drop();

// Default admin user (password: RoboShop@1)
// BCrypt hash generated with 10 rounds
db.users.insertOne({
    username: 'admin',
    email: 'admin@roboshop.com',
    password: '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
    firstName: 'Admin',
    lastName: 'User',
    phone: '555-0100',
    createdAt: new Date()
});

db.users.createIndex({ username: 1 }, { unique: true });
db.users.createIndex({ email: 1 }, { unique: true });

print('Users seed data loaded successfully');
