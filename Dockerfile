FROM node:20-slim

# Install Python and yt-dlp
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install yt-dlp --break-system-packages

WORKDIR /app

COPY package.json .
RUN npm install --production

COPY index.js .

EXPOSE 3000

CMD ["node", "index.js"]
