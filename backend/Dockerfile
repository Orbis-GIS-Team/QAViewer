FROM node:24-bookworm-slim

WORKDIR /workspace

COPY backend/package*.json ./backend/
RUN cd backend && npm install

COPY backend ./backend
COPY data/standardized ./data/standardized

WORKDIR /workspace/backend

CMD ["npm", "run", "dev"]
