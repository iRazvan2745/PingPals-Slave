FROM oven/bun:latest

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install

# Copy source files
COPY src ./src
COPY tsconfig.json ./

# Set environment
ENV NODE_ENV=production

# Expose default port
EXPOSE 3001

# Start slave
CMD ["bun", "run", "src/index.ts"]
