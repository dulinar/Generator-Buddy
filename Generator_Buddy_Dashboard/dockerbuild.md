# Deploying Generator Buddy on Ubuntu 24.04.4 LTS (ARM64)

This guide provides end-to-end instructions for building, running, and deploying **Generator Buddy** inside Docker on an **Ubuntu 24.04.4 LTS arm64 (aarch64)** server (such as AWS Graviton, Oracle Cloud Ampere A1, Raspberry Pi 4/5, or ARM64 VPS).

---

## 1. System & Architecture Verification

Log into your Ubuntu 24.04.4 LTS server via SSH and verify your CPU architecture and OS version:

```bash
# Check CPU Architecture (should return aarch64 or arm64)
uname -m

# Check Ubuntu Release (should return Ubuntu 24.04.x LTS)
lsb_release -a
```

---

## 2. Install Docker & Docker Compose on Ubuntu 24.04 LTS

If Docker is not already installed, install the latest official Docker Engine and Compose plugin:

```bash
# 1. Update package index and install prerequisites
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg lsb-release

# 2. Add Docker's official GPG key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# 3. Set up the Docker APT repository for Ubuntu 24.04 (Noble) ARM64
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# 4. Install Docker Engine, CLI, Containerd, and Docker Compose Plugin
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 5. Enable and start Docker service
sudo systemctl enable --now docker

# 6. (Optional) Run Docker without sudo
sudo usermod -aG docker $USER
newgrp docker

# 7. Verify Docker installation
docker --version
docker compose version
```

---

## 3. Clone or Copy Generator Buddy to Server

Clone your repository or copy the project files to `/opt/generator-buddy` (or your home directory):

```bash
# Example: clone into /opt/generator-buddy
sudo mkdir -p /opt/generator-buddy
sudo chown $USER:$USER /opt/generator-buddy
cd /opt/generator-buddy

# Copy your project files here (via git clone, rsync, or scp)
# git clone <your-repo-url> .
```

Ensure the project directory has the following structure:
```text
/opt/generator-buddy/
├── Dockerfile
├── docker-compose.yml
├── dockerbuild.md
├── .dockerignore
├── .env
├── package.json
├── package-lock.json
├── server.js
├── lib/
├── routes/
└── public/
```

---

## 4. Configure Environment Variables (`.env`)

Create or update the `.env` file on your server:

```bash
nano .env
```

Add your production environment configuration:

```env
# Application Port
PORT=3000
NODE_ENV=production

# MySQL Database Connection
MYSQL_HOST=141.148.197.200
MYSQL_PORT=3307
MYSQL_USER=project
MYSQL_PASSWORD=Dulina123
MYSQL_DATABASE=generator_monitoring

# Cookie Session Secret (Generate a strong 32-byte hex string)
SESSION_SECRET=e7b9a4c2f6d81a3c5e7b94c2f6d81a3c5e7b94c2f6d81a3c5e7b94c2f6d81a3c

# Set to "true" if running behind HTTPS (Nginx SSL/Certbot); set to "false" if accessing via plain HTTP
COOKIE_SECURE=false
```

> **Tip:** You can generate a random `SESSION_SECRET` on Ubuntu with:
> ```bash
> openssl rand -hex 32
> ```

---

## 5. Build the Docker Image for ARM64

### Method A: Build directly on your Ubuntu ARM64 server (Recommended)

Run the standard `docker build` command. Docker will automatically compile for the host's native `linux/arm64` architecture:

```bash
docker build -t generator-buddy:latest .
```

### Method B: Cross-compile from another machine (e.g., x86_64 PC or Mac)

If you are building the image on an Intel/AMD machine to push to an ARM64 server or registry:

```bash
docker buildx build --platform linux/arm64 -t generator-buddy:latest --load .
```

---

## 6. Run Generator Buddy

### Option A: Using Docker Compose (Recommended)

Start the container in detached background mode:

```bash
docker compose up -d
```

To stop:
```bash
docker compose down
```

To restart:
```bash
docker compose restart
```

### Option B: Using `docker run` directly

```bash
docker run -d \
  --name generator-buddy-dashboard \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  generator-buddy:latest
```

---

## 7. Verify Container Status & Health

1. Check running containers and healthcheck status:
   ```bash
   docker ps
   ```
   *(Status should show `Up ... (healthy)`)*

2. View live application logs:
   ```bash
   docker logs -f generator-buddy-dashboard
   ```
   *(Expected output: `Generator Buddy listening on http://localhost:3000`)*

3. Test local HTTP response from inside the server:
   ```bash
   curl -I http://localhost:3000/
   curl -s http://localhost:3000/api/session
   ```

---

## 8. Configure Ubuntu Firewall (UFW)

Ensure your server firewall allows incoming web traffic:

```bash
# Allow SSH so you don't lose connection
sudo ufw allow 22/tcp

# Allow HTTP and HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# If accessing port 3000 directly:
sudo ufw allow 3000/tcp

# Enable firewall (if not already active)
sudo ufw enable
sudo ufw status
```

You can now open your browser and navigate to:
`http://<YOUR_SERVER_IP>:3000`

---

## 9. (Optional) Production Setup with Nginx & Let's Encrypt SSL

For a production deployment with a domain name and automatic HTTPS certificate:

### 1. Install Nginx and Certbot

```bash
sudo apt-get update
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

### 2. Configure Nginx Reverse Proxy

Create an Nginx configuration file:

```bash
sudo nano /etc/nginx/sites-available/generator-buddy
```

Paste the following configuration (replace `monitor.yourdomain.com` with your domain):

```nginx
server {
    listen 80;
    server_name monitor.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable the site and test configuration:

```bash
sudo ln -s /etc/nginx/sites-available/generator-buddy /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 3. Obtain Free Let's Encrypt SSL Certificate

```bash
sudo certbot --nginx -d monitor.yourdomain.com
```

Once HTTPS is active, change `COOKIE_SECURE=true` in your `.env` file and restart Generator Buddy:

```bash
docker compose restart
```

---

## 10. Updating Generator Buddy in the Future

When you make updates to the codebase:

```bash
cd /opt/generator-buddy

# Pull latest code
git pull origin main

# Rebuild and restart with zero-downtime container swap
docker compose build --no-cache
docker compose up -d --force-recreate
```
