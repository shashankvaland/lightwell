# Going live: DigitalOcean, MongoDB Atlas and the domain names (MLH prizes)

One server hosts everything: `backend/app.py` serves the website at `/` and the agent API at `/api/*`.
The page finds the API on its own server, so nothing needs to change in `config.js`.

## 1. MongoDB Atlas: the team's shared run history (Best Use of MongoDB Atlas)

Every finished agent run and every Ask Lightwell answer is saved (`backend/store.py`).
The Agent tab then shows **Team history**: which towers win most often across everyone's briefs (an Atlas
aggregation), plus the latest runs. Click a run to reload its brief.

1. On mongodb.com/atlas, create a free M0 cluster.
2. Under *Database Access*, add a user. Under *Network Access*, allow `0.0.0.0/0` (needed for DigitalOcean).
3. Go to *Connect -> Drivers -> Python* and copy the `mongodb+srv://...` string.
4. Locally, put it in `.env` as `MONGODB_URI=...`, then:

   ```
   pip install -r backend/requirements.txt
   ```

5. Restart the backend. `/api/health` should now show `"store": true`.
   If it shows `store_error`, check the password and the IP list.

API: `GET /api/runs`, `GET /api/leaderboard`, `GET /api/towers/{id}/history`.
Without `MONGODB_URI` nothing is saved and the panel stays hidden.

## 2. DigitalOcean App Platform (Best Use of DigitalOcean)

1. Push to `main` (the spec deploys `main`; change `branch` in `.do/app.yaml` to deploy another branch).
2. Go to cloud.digitalocean.com -> *Create -> App -> GitHub -> shashankvaland/lightwell*. DigitalOcean finds the
   `Dockerfile`. Or, with the CLI:

   ```
   doctl apps create --spec .do/app.yaml
   ```

3. In *Settings -> Environment Variables*, set `MONGODB_URI` and, optionally, `ANTHROPIC_API_KEY` as **encrypted**
   values. Never put keys in the spec file.
4. Open the `*.ondigitalocean.app` URL. The Agent tab should say "Backend running…".

Test the same image locally:

```
docker build -t lightwell .
docker run -p 8080:8080 --env-file .env lightwell
```

Then open http://localhost:8080.

**Licensed data stays private:**
- The deployed site builds from GitHub, so it never gets `real-data/` or `real_overlay.js`. It runs in demo mode.
- `.dockerignore` also keeps those files, `.env` and `config.js` out of a locally built image.
- Show the real CoStar data on the demo laptop, not on the public URL.

**Cost:** with `ANTHROPIC_API_KEY` set, anyone with the URL can run Claude on your key. Set a spend limit in the
Anthropic console, or leave the key off the public app; the fixed plan still runs.

## 3. Domain names (GoDaddy Registry, .Tech)

Register them with the MLH codes at the MLH table. Then, in the DigitalOcean app, go to *Settings -> Domains -> Add
domain* and add the CNAME it gives you at the registrar. HTTPS is automatic.

Shortlist. None of these had DNS records on 2026-11-15; confirm at checkout:

| Domain | Why it's funny |
|---|---|
| **sleepatwork.co** | it's literally the product: sleeping where you used to work |
| iliveatwork.co | same joke, first person |
| cubicletocouch.co / .us | the conversion in three words |
| deskstodens.co | desks to dens |
| officesbutcozy.co | the elevator pitch |
| **lightwellhouston.tech** | for the .Tech prize (lightwell.tech is taken) |
| sleepatwork.tech | the joke, on .tech |

Check which endings the GoDaddy Registry code covers (often .co, .us, .biz, .club) before choosing.
