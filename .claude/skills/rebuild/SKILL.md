---
name: rebuild
description: Rebuild and restart the local Goodstock Docker container in WSL Ubuntu. Use when the user says "rebuild" (or asks to rebuild/redeploy the app locally).
---

# Rebuild the local Docker container

1. Run this exact command with the PowerShell tool (timeout 600000):

   ```
   wsl -d Ubuntu -- bash -lc "cd '/mnt/g/VS code - projects/kitchen app' && docker compose -f docker-compose.yml up --build -d"
   ```

2. Confirm it is up by running `wsl -d Ubuntu -- docker ps --filter name=goodstock-kitchen` and checking that `http://localhost:8484/` returns 200 and `/api/mealie/status` responds.

3. Report briefly: built and running, or the build/start error output if it failed.
