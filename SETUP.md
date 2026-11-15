# Setting up F1 Underground

About 30 minutes, all free tiers, no commands to type. Keep a note open
(Notepad is fine) to paste values into as you go.

## 1. A new Vercel project (the old app stays untouched)

1. vercel.com → **Add New… → Project** → **Import** next to
   **NEW-F1Underground**. (If it isn't listed, click "Adjust GitHub App
   Permissions" and allow Vercel access to that repository.)
2. Project name: `new-f1-underground` (that becomes the address
   https://new-f1-underground.vercel.app; if Vercel says the name is taken,
   pick another and use that address everywhere below).
3. Leave everything else as it is and click **Deploy**. The first deploy
   fails or shows errors until the settings below are in; that's expected.

The old app keeps running at f1-underground.vercel.app. When you're ready to
retire it, the address can be moved to the new project in one step
(Settings → Domains).

## 2. Database (Neon, through Vercel)

1. In the project, open the **Storage** tab → **Create Database** → **Neon**
   (Serverless Postgres) → accept the free plan, region **US East**.
2. Connect it to the project for all environments. Vercel adds
   `DATABASE_URL` for you; nothing to copy.

The tables are created automatically on the next deploy.

## 3. Sign-in secret

1. Open https://generate-secret.vercel.app/32 and copy the text it shows.
2. Vercel → Settings → Environment Variables → add `AUTH_SECRET` = that text.

## 4. Email (Gmail app password)

The free `*.vercel.app` address can't be verified with an email service, so
the app sends from an ordinary Gmail account (500 emails a day, plenty).

1. myaccount.google.com → **Security** → make sure **2-Step Verification**
   is on.
2. Search the page for **App passwords**, create one named `F1 Underground`,
   copy the 16 letters (no spaces).
3. Add to Vercel:
   - `EMAIL_SERVER` = `smtps://YOURNAME%40gmail.com:THE16LETTERS@smtp.gmail.com:465`
     (write your Gmail address with `%40` instead of `@`)
   - `EMAIL_FROM` = `F1 Underground <YOURNAME@gmail.com>`

## 5. Google sign-in

1. console.cloud.google.com → project picker → **New project** →
   `F1 Underground`.
2. **APIs & Services → OAuth consent screen** → External → app name
   `F1 Underground`, your email in both email fields → save. Then
   **Publish app** (no Google review is needed for name and email only).
3. **Credentials → Create credentials → OAuth client ID** → Web
   application. Under **Authorised redirect URIs** add
   `https://new-f1-underground.vercel.app/api/auth/callback/google`.
4. Copy the **Client ID** and **Client secret** into Vercel as
   `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.

## 6. You as commissioner, then publish

1. Vercel: add `BOOTSTRAP_COMMISSIONER_EMAILS` = your Gmail address.
2. **Deployments** tab → the latest one → **⋯ → Redeploy**. Wait for
   "Ready" (about 2 minutes).
3. Open https://new-f1-underground.vercel.app and sign in with that Gmail
   address: you're the commissioner. On **Admin**, add the 2026 players as
   profiles and copy the join link.

From now on every change pushed to GitHub publishes itself.

## Trying it on your own computer (optional, no accounts needed)

1. Install Node.js (the "LTS" button on nodejs.org) once.
2. Open this folder in a terminal (in GitHub Desktop: Repository → Open in
   Command Prompt).
3. Run, one at a time: `npm install`, then `npm run db:local`, then
   `npm run dev:local`.
4. Open http://localhost:3000 and click **Local demo: skip sign-in**.
5. To stop it, press Ctrl+C in the terminal.

Sign-in links and invite emails are printed in the terminal instead of sent.
`npm run db:local` resets the demo data whenever you want a clean start.

## Checks (for developers)

```
npm test        # league rules against a real Postgres (PGlite)
npm run lint
npm run build   # also updates the database when DATABASE_URL is set
```
