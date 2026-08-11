#!/bin/bash
# Start the AHD Backup API server
cd /root/projects/a-house-divided
export $(cat .env.backup-api | xargs)
exec node scripts/backup-api.js
