---
Task ID: 1
Agent: Main Agent
Task: Set up Razkindo2 ERP application with Supabase backend

Work Log:
- Extracted and configured existing Razkindo ERP project
- Set up Supabase connection with publishable key (sb_publishable_*)
- Verified REST API works with publishable key (RLS disabled on all tables)
- Pushed Prisma schema to Supabase PostgreSQL
- Seeded database successfully
- Fixed dev server stability: turbopack causes crashes, switched to webpack mode
- Added --max-old-space-size=4096 for Node.js heap
- Generated VAPID keys for push notifications
- Added VAPID keys, AUTH_SECRET to .env
- Created cron watchdog to keep dev server running (every 5 min)
- Comprehensive API testing: all endpoints working

Stage Summary:
- Server running on port 3000 with webpack mode
- Login works (admin@razkindo.com / admin123)
- Dashboard shows: Rp 4,250,000 total sales, 2 transactions
- 5 products, 3 units (Jakarta, Bandung, Surabaya), 4 customers
- Push notifications configured with VAPID keys
- Database: Supabase PostgreSQL (ap-southeast-1)
- RPC functions deployed (11/11)
