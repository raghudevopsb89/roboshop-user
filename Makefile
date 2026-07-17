.PHONY: build run unit-test coverage integration-test docker-build db-init clean

build:
	npm install

run:
	MONGO_URL=mongodb://localhost:27017/users node server.js

unit-test:
	npm test

coverage:
	npm run test:coverage

integration-test:
	npm run test:integration

docker-build:
	env
	docker build -t raghudevopsb89.azurecr.io/roboshop-user:${GITHUB_SHA} .

docker-push:
	docker push raghudevopsb89.azurecr.io/roboshop-user:${GITHUB_SHA}

docker-scan:
	trivy image raghudevopsb89.azurecr.io/roboshop-user:${GITHUB_SHA} --exit-code 1 --ignore-unfixed -s HIGH,CRITICAL

db-init:
	mongosh --host $${MONGO_HOST:-localhost} < db/master-data.js

clean:
	rm -rf node_modules

sonar_token := $(shell az keyvault secret show --name sonarqube-token --vault-name roboshopb89 --query "value" -o tsv)

sonar-scan:
	echo /home/runner/sonar-scanner-7.1.0.4889-linux-x64/bin/sonar-scanner -Dsonar.projectKey=roboshop-user -Dsonar.host.url=http://10.1.0.46:9000 -Dsonar.token=$(sonar_token) -Dsonar.qualitygate.wait=true -Dsonar.javascript.lcov.reportPaths=coverage/lcov.info
