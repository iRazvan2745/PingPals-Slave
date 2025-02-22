FROM oven/bun:1.0.25

WORKDIR /app

# Copy package files
COPY package.json bun ./

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
