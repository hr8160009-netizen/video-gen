FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src
RUN mkdir -p /app/outputs
ENV NODE_ENV=production PORT=8080 OUTPUT_DIR=/app/outputs
EXPOSE 8080
CMD ["npm", "start"]
