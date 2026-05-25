.PHONY: build run docker-build db-init clean

build:
	npm install

run:
	MONGO_URL=mongodb://localhost:27017/users node server.js

docker-build:
	docker build -t roboshop-user .

db-init:
	mongosh --host $${MONGO_HOST:-localhost} < db/master-data.js

clean:
	rm -rf node_modules
