#!/bin/bash
# =====================================================================
# Razkindo2 ERP - One-Click Install Script for CasaOS
# =====================================================================
# Usage:
#   bash install.sh [GITHUB_REPO_URL] [BRANCH]
#
# Quick install from GitHub:
#   git clone https://github.com/razkindopaper-hue/RAZKINDO-ERP2.git /DATA/AppData/razkindo2-erp
#   cd /DATA/AppData/razkindo2-erp && bash install.sh
# =====================================================================

set -e

# ---- Colors ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "============================================"
echo "  Razkindo2 ERP - Installer"
echo "============================================"
echo -e "${NC}"

# ---- Check Docker ----
if ! command -v docker &>/dev/null; then
    echo -e "${RED}[ERROR] Docker not found. Please install Docker first.${NC}"
    exit 1
fi

if ! docker compose version &>/dev/null; then
    echo -e "${RED}[ERROR] Docker Compose not found.${NC}"
    exit 1
fi

echo -e "${GREEN}[OK]${NC} Docker & Docker Compose found"

# ---- Config ----
REPO_URL="${1:-}"
BRANCH="${2:-main}"
APP_NAME="razkindo2-erp"
INSTALL_DIR="/DATA/AppData/${APP_NAME}"

# If REPO_URL provided, clone
if [ -n "$REPO_URL" ]; then
    echo -e "${BLUE}[1/4] Cloning repository...${NC}"
    REPO_URL="${REPO_URL%.git}"
    if [ -d "$INSTALL_DIR" ]; then
        cd "$INSTALL_DIR"
        git pull origin "$BRANCH" || true
    else
        mkdir -p "$(dirname "$INSTALL_DIR")"
        git clone -b "$BRANCH" "${REPO_URL}.git" "$INSTALL_DIR"
    fi
    cd "$INSTALL_DIR"
else
    # Find project directory
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    if [ -f "$SCRIPT_DIR/docker-compose.yml" ]; then
        cd "$SCRIPT_DIR"
        INSTALL_DIR="$SCRIPT_DIR"
    else
        echo -e "${RED}[ERROR] No docker-compose.yml found.${NC}"
        echo "  Usage:"
        echo "    bash install.sh https://github.com/razkindopaper-hue/RAZKINDO-ERP2.git"
        echo "    OR run from the project directory"
        exit 1
    fi
fi

echo -e "${GREEN}[OK]${NC} Working directory: $(pwd)"

# ---- Setup .env file ----
echo ""
echo -e "${BLUE}[2/4] Setting up environment variables...${NC}"

# Check for existing env files
if [ -f ".env" ]; then
    echo -e "${GREEN}[OK]${NC} .env file found — using existing configuration"
elif [ -f ".env.local" ]; then
    echo -e "${GREEN}[OK]${NC} .env.local found — copying to .env"
    cp .env.local .env
else
    echo -e "${YELLOW}No .env file found. Creating template...${NC}"
    echo ""
    cat > .env << 'ENVEOF'
# ============================================================
# Razkindo2 ERP - Environment Configuration
# ============================================================

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
NEXTAUTH_SECRET=CHANGE_ME
NEXTAUTH_URL=http://localhost:8180

# Auth Secret
AUTH_SECRET=CHANGE_ME

# VAPID Push Notification Keys
NEXT_PUBLIC_VAPID_PUBLIC_KEY=YOUR_VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY=YOUR_VAPID_PRIVATE_KEY
VAPID_SUBJECT=mailto:admin@razkindo.com

# WebSocket Event Queue
WS_SECRET=CHANGE_ME
WS_PORT=3004
WS_INTERNAL_URL=http://127.0.0.1:3004
ENVEOF

    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}  ⚠️  You MUST edit .env with your credentials!${NC}"
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo "  File: ${INSTALL_DIR}/.env"
    echo ""
    echo "  Generate secrets with: openssl rand -base64 32"
    echo ""

    read -p "Have you edited the .env file? (y/n): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}Stopped. Edit .env first, then re-run: bash install.sh${NC}"
        exit 1
    fi
fi

# ---- Build Docker Image ----
echo ""
echo -e "${BLUE}[3/4] Building Docker image (5-15 minutes)...${NC}"

docker build -t razkindo2-erp:latest . 2>&1 | tail -20

if [ $? -ne 0 ]; then
    echo -e "${RED}[ERROR] Docker build failed.${NC}"
    exit 1
fi

echo -e "${GREEN}[OK]${NC} Image built: razkindo2-erp:latest"

# ---- Start Container ----
echo ""
echo -e "${BLUE}[4/4] Starting Razkindo2 ERP...${NC}"

docker compose down 2>/dev/null || true
docker compose up -d

echo -e "${YELLOW}  Waiting for app to start...${NC}"
sleep 5

# ---- Summary ----
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' | head -1)

echo ""
echo -e "${GREEN}============================================"
echo -e "  ✅ Installation Complete!"
echo -e "============================================${NC}"
echo ""
echo -e "  Access: ${CYAN}http://${LOCAL_IP}:8180${NC}"
echo ""
echo -e "  Commands:"
echo -e "    Logs:     ${YELLOW}docker logs -f razkindo2-erp${NC}"
echo -e "    Stop:     ${YELLOW}cd ${INSTALL_DIR} && docker compose down${NC}"
echo -e "    Restart:  ${YELLOW}cd ${INSTALL_DIR} && docker compose restart${NC}"
echo -e "    Update:   ${YELLOW}cd ${INSTALL_DIR} && git pull && docker compose up -d --build${NC}"
echo ""
