#!/bin/bash
# =====================================================================
# Razkindo2 ERP - One-Click Install Script for CasaOS
# =====================================================================
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/YOUR_GITHUB_USER/razkindo2-erp/main/install.sh | bash
#
# Or if you already have the source code:
#   chmod +x install.sh && ./install.sh
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
    echo "  CasaOS already includes Docker. If missing:"
    echo "  curl -fsSL https://get.docker.com | sh"
    exit 1
fi

if ! docker compose version &>/dev/null; then
    echo -e "${RED}[ERROR] Docker Compose not found.${NC}"
    echo "  CasaOS should include it. Try: apt install docker-compose-plugin"
    exit 1
fi

echo -e "${GREEN}[OK] Docker & Docker Compose found${NC}"

# ---- Config ----
REPO_URL="${1:-}"
BRANCH="${2:-main}"
APP_NAME="razkindo2-erp"
INSTALL_DIR="/DATA/AppData/${APP_NAME}"

# If REPO_URL provided, clone. Otherwise assume source already in INSTALL_DIR.
if [ -n "$REPO_URL" ]; then
    echo -e "${BLUE}[1/4] Cloning repository...${NC}"
    if [ -d "$INSTALL_DIR" ]; then
        echo -e "${YELLOW}  Directory exists. Pulling latest...${NC}"
        cd "$INSTALL_DIR"
        git pull origin "$BRANCH" || true
    else
        mkdir -p "$(dirname "$INSTALL_DIR")"
        git clone -b "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
    fi
    cd "$INSTALL_DIR"
else
    # Try to find docker-compose.yml in current directory or parent
    SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
    if [ -f "$SCRIPT_DIR/docker-compose.yml" ]; then
        cd "$SCRIPT_DIR"
        INSTALL_DIR="$SCRIPT_DIR"
    else
        echo -e "${RED}[ERROR] No docker-compose.yml found.${NC}"
        echo "  Either:"
        echo "    1. Provide GitHub URL: ./install.sh https://github.com/USER/razkindo2-erp.git"
        echo "    2. Run from the project directory that contains docker-compose.yml"
        exit 1
    fi
fi

echo -e "${GREEN}[OK] Working directory: $(pwd)${NC}"

# ---- Check .env.local for auto-fill ----
ENV_FILE=".env.local"
ENV_BACKUP=".env.backup"

if [ -f "$ENV_FILE" ]; then
    echo -e "${BLUE}[2/4] Found .env.local - extracting environment variables...${NC}"
    cp "$ENV_FILE" "$ENV_BACKUP" 2>/dev/null || true

    # Extract values from .env.local and inject into docker-compose.yml
    if command -v sed &>/dev/null; then
        for VAR in DATABASE_URL DIRECT_URL SUPABASE_DB_URL SUPABASE_POOLER_URL \
                   SUPABASE_SESSION_POOL_URL NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY \
                   SUPABASE_SERVICE_ROLE_KEY NEXTAUTH_SECRET NEXTAUTH_URL AUTH_SECRET \
                   NEXT_PUBLIC_VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY WS_SECRET; do
            VAL=$(grep "^${VAR}=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d'=' -f2- | sed 's/^"//' | sed 's/"$//')
            if [ -n "$VAL" ]; then
                # Replace placeholder in docker-compose.yml
                sed -i "s|${VAR}=.*|${VAR}=${VAL}|g" docker-compose.yml 2>/dev/null || true
                echo -e "  ${GREEN}✓${NC} ${VAR}"
            fi
        done
    fi
else
    echo -e "${YELLOW}[2/4] No .env.local found. You must edit docker-compose.yml manually.${NC}"
    echo -e "${YELLOW}  Run: nano docker-compose.yml${NC}"
    echo ""
    read -p "Have you configured the environment variables? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${RED}Aborted. Please configure environment variables first.${NC}"
        echo "  Edit docker-compose.yml and fill in:"
        echo "    - DATABASE_URL, DIRECT_URL, SUPABASE_DB_URL"
        echo "    - NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY"
        echo "    - SUPABASE_SERVICE_ROLE_KEY"
        echo "    - NEXTAUTH_SECRET, AUTH_SECRET"
        echo "    - WS_SECRET"
        exit 1
    fi
fi

echo -e "${GREEN}[OK] Environment variables ready${NC}"

# ---- Build Docker Image ----
echo -e "${BLUE}[3/4] Building Docker image (this may take 5-15 minutes)...${NC}"
echo -e "${YELLOW}  Building razkindo2-erp:latest ...${NC}"

docker build -t razkindo2-erp:latest . 2>&1 | tail -20

if [ $? -ne 0 ]; then
    echo -e "${RED}[ERROR] Docker build failed.${NC}"
    exit 1
fi

echo -e "${GREEN}[OK] Image built successfully${NC}"

# ---- Start Container ----
echo -e "${BLUE}[4/4] Starting Razkindo2 ERP...${NC}"

# Stop existing container if running
docker compose down 2>/dev/null || true

# Start fresh
docker compose up -d

# Wait for health check
echo -e "${YELLOW}  Waiting for app to start...${NC}"
sleep 5

MAX_WAIT=60
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    if docker exec razkindo2-erp wget -qO- http://localhost:3000/ >/dev/null 2>&1; then
        echo -e "${GREEN}[OK] App is running!${NC}"
        break
    fi
    sleep 2
    WAITED=$((WAITED + 2))
    echo -e "  Waiting... (${WAITED}s)"
done

if [ $WAITED -ge $MAX_WAIT ]; then
    echo -e "${YELLOW}[WARN] App may still be starting. Check: docker logs razkindo2-erp${NC}"
fi

# ---- Summary ----
echo ""
echo -e "${CYAN}============================================"
echo -e "  Installation Complete!"
echo -e "============================================${NC}"
echo ""
echo -e "  ${GREEN}Access your ERP:${NC}"
echo -e "    URL:    ${CYAN}http://$(hostname -I 2>/dev/null | awk '{print $1}' | head -1):8180${NC}"
echo -e "    Local:  ${CYAN}http://localhost:8180${NC}"
echo ""
echo -e "  ${GREEN}Useful commands:${NC}"
echo -e "    View logs:     ${YELLOW}docker logs -f razkindo2-erp${NC}"
echo -e "    Stop:          ${YELLOW}docker compose down${NC}"
echo -e "    Restart:       ${YELLOW}docker compose restart${NC}"
echo -e "    Rebuild:       ${YELLOW}docker compose build && docker compose up -d${NC}"
echo -e "    Update:        ${YELLOW}git pull && docker compose build && docker compose up -d${NC}"
echo ""
echo -e "  ${GREEN}CasaOS:${NC}"
echo -e "    Open CasaOS App Store to see Razkindo2 ERP card."
echo ""
