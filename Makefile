.PHONY: help setup install dev build preview test test-e2e docker-dev docker-prod clean

help:
	@echo "TitrVis — make commands"
	@echo ""
	@echo "  make setup        Install dependencies (automated)"
	@echo "  make install      Install dependencies only"
	@echo "  make dev          Start development server (http://localhost:5173)"
	@echo "  make build        Build for production"
	@echo "  make preview      Preview production build (http://localhost:4173)"
	@echo "  make test         Run unit tests"
	@echo "  make test-e2e     Run browser tests"
	@echo "  make docker-dev   Run dev server in Docker"
	@echo "  make docker-prod  Run production build in Docker"
	@echo "  make clean        Remove node_modules and build artifacts"
	@echo ""

setup:
	@echo "🧪 Setting up TitrVis..."
	@chmod +x setup.sh
	@./setup.sh

install:
	npm install --prefer-offline --no-audit

dev:
	npm run dev

build:
	npm run build

preview:
	npm run preview

test:
	npm test

test-e2e:
	npm run test:e2e

docker-dev:
	docker-compose up titrvis-dev

docker-prod:
	docker-compose up titrvis-prod

clean:
	rm -rf node_modules dist .next
	@echo "✓ Cleaned up build artifacts"
