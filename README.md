# Goodstock Kitchen

A touch-friendly kitchen planner with inventory, weekly meals, a shopping list, and optional Mealie recipe search. The Node service uses only built-in modules; state is stored in a persistent JSON file in the mounted `/data` volume. The browser keeps a local copy and queues the latest changes while offline.

## Deploy in Portainer

1. Put this project folder somewhere Portainer can access, or push it to a Git repository.
2. In Portainer, choose **Stacks** and deploy from that Git repository. Set the repository path to this project folder and the Compose path to `docker-compose.yml` (Portainer's default filename), so it can build the included `Dockerfile`.
3. Optionally set `MEALIE_URL` and `MEALIE_API_KEY` in the stack environment. `MEALIE_URL` is the address reachable from the container, for example `http://mealie:9000` when both containers share a Docker network.
4. Deploy the stack and open `http://<your-server-ip>:8484` on the tablet or another browser.

The named `goodstock-data` volume keeps inventory and planning data across container updates. Back up that volume with your normal Docker backup process. Do not publish the app directly to the internet without putting authentication and HTTPS in front of it; the initial version is intended for a trusted home network.

## Mealie

When both environment variables are set, the Recipes view searches Mealie and lets you import recipes into Goodstock. Goodstock owns the inventory, weekly plan, and shopping list; imported recipes are stored in its own data volume.

## Offline behavior

After the first online visit, the browser caches the app shell and keeps the latest kitchen state on that device. Inventory and planning remain viewable offline. Changes are saved locally and the newest state is sent to the server after connectivity returns. Keep a single household tablet as the active editor; simultaneous edits from multiple devices are last-write-wins in this first version.