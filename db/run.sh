#!/usr/bin/env bash
set -e

: "${MONGO_URL:?MONGO_URL is required}"

echo "Seeding MongoDB at ${MONGO_URL}..."
mongosh "$MONGO_URL" --file /db/master-data.js
echo "User database setup complete"
