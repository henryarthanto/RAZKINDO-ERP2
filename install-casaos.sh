#!/bin/bash
# =====================================================================
# Razkindo2 ERP - Automated CasaOS Installer
# =====================================================================
# Usage:
#   bash install-casaos.sh
#
# Prerequisites:
#   - Docker & Docker Compose installed (CasaOS has these)
#   - Internet connection
#   - GitHub repo URL (will prompt if not set)
# =====================================================================

set -e

# ---- Configuration ----
APP_NAME="razkindo2-erp"
INSTALL_DIR="/DATA/AppData/${APP_NAME}"
GITHUB_REPO="${GITHUB_REPO:-}"  # Set env var or will prompt
BRANCH="${BRANCH:-main}"
PORT="${PORT:-8180}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     Razkindo2 ERP - CasaOS Installer        ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

# ---- Check Docker ----
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed!${NC}"
    echo "Please install Docker first: https://docs.docker.com/get-docker/"
    exit 1
fi

if ! docker compose version &> /dev/null && ! docker-compose version &> /dev/null; then
    echo -e "${RED}Error: Docker Compose is not installed!${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Docker & Docker Compose found"

# ---- Get GitHub Repo URL ----
if [ -z "$GITHUB_REPO" ]; then
    echo ""
    echo -e "${YELLOW}GitHub repository URL required.${NC}"
    echo "Example: https://github.com/yourusername/razkindo2-erp"
    echo ""
    read -p "Enter GitHub repo URL: " GITHUB_REPO
fi

# Remove trailing .git if present
GITHUB_REPO="${GITHUB_REPO%.git}"

if [ -z "$GITHUB_REPO" ]; then
    echo -e "${RED}Error: No GitHub repo URL provided${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} GitHub repo: ${GITHUB_REPO}"

# ---- Create Install Directory ----
echo ""
echo -e "${CYAN}[1/5]${NC} Creating install directory: ${INSTALL_DIR}"
mkdir -p "${INSTALL_DIR}"
cd "${INSTALL_DIR}"

# ---- Clone or Pull ----
if [ -d ".git" ]; then
    echo -e "${CYAN}[2/5]${NC} Updating existing installation..."
    git pull origin "${BRANCH}" || {
        echo -e "${YELLOW}Warning: git pull failed, continuing with existing code${NC}"
    }
else
    echo -e "${CYAN}[2/5]${NC} Cloning repository..."
    git clone -b "${BRANCH}" "${GITHUB_REPO}" . || {
        echo -e "${RED}Error: Failed to clone repository${NC}"
        echo "Please check the URL and make sure the repo is accessible"
        exit 1
    }
fi

echo -e "${GREEN}✓${NC} Source code ready"

# ---- Setup Environment ----
echo ""
echo -e "${CYAN}[3/5]${NC} Setting up environment variables..."

if [ ! -f ".env" ]; then
    echo -e "${YELLOW}No .env file found. Creating from template...${NC}"
    cat > .env << 'ENVEOF'
# ============================================================
# Razkindo2 ERP - Environment Configuration
# ============================================================
# IMPORTANT: Fill in all YOUR_* values before starting!

# Database - Supabase PostgreSQL
DATABASE_URL=postgresql://postgres.YOUR_PROJECT_REF:YOUR_PASSWORD@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres.YOUR_PROJECT_REF:YOUR_PASSWORD@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres
SUPABASE_DB_URL=postgresql://postgres:YOUR_PASSWORD@db.YOUR_PROJECT_REF.supabase.co:5432/postgres
SUPABASE_POOLER_URL=postgresql://postgres.YOUR_PROJECT_REF:YOUR_PASSWORD@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres
SUPABASE_SESSION_POOL_URL=postgresql://postgres.YOUR_PROJECT_REF:YOUR_PASSWORD@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres

# Supabase REST API
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY

# NextAuth
NEXTAUTH_SECRET=GENERATE_WITH_openssl_rand_base64_32
NEXTAUTH_URL=http://localhost:8180

# Auth Secret
AUTH_SECRET=GENERATE_WITH_openssl_rand_base64_32

# VAPID Push Notification Keys
NEXT_PUBLIC_VAPID_PUBLIC_KEY=YOUR_VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY=YOUR_VAPID_PRIVATE_KEY
VAPID_SUBJECT=mailto:admin@razkindo.com

# WebSocket Event Queue
WS_SECRET=GENERATE_WITH_openssl_rand_base64_32
WS_PORT=3004
WS_INTERNAL_URL=http://127.0.0.1:3004
ENVEOF

    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}  ⚠️  ACTION REQUIRED: Edit .env file with your credentials!${NC}"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "  File location: ${INSTALL_DIR}/.env"
    echo ""
    echo "  Required values to fill:"
    echo "    1. YOUR_PROJECT_REF  → Your Supabase project reference"
    echo "    2. YOUR_PASSWORD     → Your Supabase database password"
    echo "    3. YOUR_ANON_KEY     → Supabase anon key"
    echo "    4. YOUR_SERVICE_ROLE → Supabase service role key"
    echo "    5. GENERATE_WITH_*   → Run: openssl rand -base64 32"
    echo ""
    echo "  Quick generate secrets:"
    echo "    echo \"NEXTAUTH_SECRET=$(openssl rand -base64 32)\""
    echo "    echo \"AUTH_SECRET=$(openssl rand -base64 32)\""
    echo "    echo \"WS_SECRET=$(openssl rand -base64 32)\""
    echo ""

    read -p "Have you filled in the .env file? (y/n): " ENV_READY
    if [ "$ENV_READY" != "y" ]; then
        echo -e "${YELLOW}Please edit .env first, then re-run this script.${NC}"
        echo "  nano ${INSTALL_DIR}/.env"
        exit 0
    fi
else
    echo -e "${GREEN}✓${NC} .env file already exists"
fi

# ---- Build Docker Image ----
echo ""
echo -e "${CYAN}[4/5]${NC} Building Docker image (this takes 5-10 minutes)..."
docker build -t ${APP_NAME}:latest . 2>&1 | tail -5

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Docker build failed!${NC}"
    exit 1
fi

echo -e "${GREEN}✓${NC} Docker image built: ${APP_NAME}:latest"

# ---- Update docker-compose.yml with port ----
echo ""
echo -e "${CYAN}[5/5]${NC} Starting services..."

# Update NEXTAUTH_URL in docker-compose.yml to use actual port
sed -i "s/NEXTAUTH_URL=.*/NEXTAUTH_URL=http:\/\/$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'localhost'):${PORT}/g" docker-compose.yml 2>/dev/null || true

# Start with docker compose
if docker compose version &> /dev/null; then
    docker compose up -d
else
    docker-compose up -d
fi

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   🎉 Razkindo2 ERP Installed Successfully!  ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
echo "  Access your ERP at: http://$(hostname -I 2>/dev/null | awk '{print $1}' || echo 'YOUR_CASAOS_IP'):${PORT}"
echo ""
echo "  Useful commands:"
echo "    docker logs -f ${APP_NAME}          # View logs"
echo "    docker compose restart              # Restart"
echo "    docker compose down                 # Stop"
echo "    docker compose up -d --build        # Rebuild & restart"
echo ""
echo "  Update to latest version:"
echo "    cd ${INSTALL_DIR} && git pull && docker compose up -d --build"
echo ""
