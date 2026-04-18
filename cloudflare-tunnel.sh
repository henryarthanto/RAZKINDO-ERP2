#!/bin/bash
# =====================================================================
# Cloudflare Tunnel Setup Script for Razkindo2 ERP
# =====================================================================
# This script helps you expose your local Docker deployment via
# Cloudflare Tunnel so anyone can access it from the internet.
#
# Prerequisites:
#   1. Docker Desktop running on MacBook
#   2. cloudflared installed: brew install cloudflared
#   3. ERP running: docker compose up -d
#
# Usage:
#   bash cloudflare-tunnel.sh          # Quick tunnel (temporary URL)
#   bash cloudflare-tunnel.sh named    # Named tunnel (persistent)
# =====================================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  Razkindo2 ERP - Cloudflare Tunnel${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

# Check if cloudflared is installed
if ! command -v cloudflared &> /dev/null; then
    echo -e "${YELLOW}cloudflared not found. Installing...${NC}"
    brew install cloudflared
fi

# Check if Docker is running
if ! docker info &> /dev/null; then
    echo -e "${YELLOW}Docker is not running. Please start Docker Desktop first.${NC}"
    exit 1
fi

# Check if ERP container is running
if ! docker ps --format '{{.Names}}' | grep -q 'razkindo'; then
    echo -e "${YELLOW}ERP container is not running. Starting...${NC}"
    cd "$(dirname "$0")"
    docker compose up -d
    sleep 5
fi

echo -e "${GREEN}✓ Docker running${NC}"
echo -e "${GREEN}✓ ERP container running${NC}"
echo ""

# Mode selection
MODE="${1:-quick}"

if [ "$MODE" = "named" ]; then
    echo -e "${CYAN}=== Named Tunnel (Persistent URL) ===${NC}"
    echo "A named tunnel gives you a permanent URL that doesn't change."
    echo "Requires a Cloudflare account and domain."
    echo ""
    
    # Check if user is logged in
    if ! cloudflared tunnel list 2>/dev/null | grep -q "ID"; then
        echo -e "${YELLOW}No tunnel found. Let's create one...${NC}"
        echo ""
        echo "1. Login to Cloudflare:"
        cloudflared tunnel login
        echo ""
        echo "2. Create tunnel:"
        read -p "   Enter tunnel name (e.g. razkindo-erp): " TUNNEL_NAME
        cloudflared tunnel create "$TUNNEL_NAME"
        echo ""
        
        TUNNEL_ID=$(cloudflared tunnel list | grep "$TUNNEL_NAME" | awk '{print $1}')
        echo "   Tunnel ID: $TUNNEL_ID"
        echo "   Tunnel URL: ${TUNNEL_ID}.cfargotunnel.com"
        
        # Create config file
        CONFIG_FILE="$HOME/.cloudflared/config.yml"
        mkdir -p "$(dirname "$CONFIG_FILE")"
        
        read -p "3. Enter your domain (e.g. erp.yourdomain.com): " DOMAIN
        
        cat > "$CONFIG_FILE" << EOF
tunnel: $TUNNEL_ID
credentials-file: $HOME/.cloudflared/$TUNNEL_ID.json

ingress:
  - hostname: $DOMAIN
    service: http://localhost:8180
  - hostname: ws.$DOMAIN
    service: http://localhost:3004
  - service: http_status:404
EOF
        
        echo ""
        echo -e "${GREEN}✓ Config saved to $CONFIG_FILE${NC}"
        echo ""
        echo "4. Add DNS record in Cloudflare dashboard:"
        echo "   Type: CNAME, Name: $DOMAIN, Target: $TUNNEL_ID.cfargotunnel.com"
        echo "   Type: CNAME, Name: ws.$DOMAIN, Target: $TUNNEL_ID.cfargotunnel.com"
        echo ""
        read -p "5. Press Enter after adding DNS records..."
        
        # Update .env
        echo ""
        echo "6. Updating NEXTAUTH_URL in .env..."
        cd "$(dirname "$0")"
        if grep -q "NEXTAUTH_URL" .env; then
            sed -i.bak "s|NEXTAUTH_URL=.*|NEXTAUTH_URL=https://$DOMAIN|" .env && rm -f .env.bak
        fi
        
        echo ""
        echo -e "${GREEN}✓ Starting named tunnel...${NC}"
        cloudflared tunnel run "$TUNNEL_NAME"
    else
        echo -e "${GREEN}Tunnel found. Starting...${NC}"
        cloudflared tunnel run
    fi
else
    echo -e "${CYAN}=== Quick Tunnel (Temporary URL) ===${NC}"
    echo "You'll get a temporary *.trycloudflare.com URL."
    echo "Perfect for testing — URL changes each time you restart."
    echo ""
    
    # Start quick tunnel and capture the URL
    TUNNEL_URL=$(cloudflared tunnel --url http://localhost:8180 2>&1 | grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' | head -1) &
    TUNNEL_PID=$!
    
    # Wait for URL
    echo -e "${YELLOW}Waiting for tunnel URL...${NC}"
    sleep 5
    
    # Kill the background process and restart with output
    kill $TUNNEL_PID 2>/dev/null
    
    echo ""
    echo -e "${GREEN}Starting Cloudflare Tunnel...${NC}"
    echo -e "${YELLOW}Your ERP will be available at the URL shown below.${NC}"
    echo -e "${YELLOW}Share this URL to access from anywhere!${NC}"
    echo ""
    
    cloudflared tunnel --url http://localhost:8180
fi
