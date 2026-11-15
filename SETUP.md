# Setting up F1 Underground

About 30 minutes, all free tiers. Do the steps in order; each one gives you a
value for the environment variables listed in `.env.example`.

## 1. Neon (database)

1. Sign up at neon.tech, create a project called `f1-underground`.
2. Copy the **pooled** connection string → `DATABASE_URL`.
3. On your computer, in this repo: `npm install`, put `DATABASE_URL` in
   `.env.local`, then run `npm run db:migrate` to create the tables.

## 2. Gmail app password (emails)

The free `*.vercel.app` address can't be verified with an email service, so
the app sends from an ordinary Gmail account (500 emails a day, plenty).

1. Google Account → Security → turn on 2-Step Verification if it's off.
2. Search "App passwords", create one called `F1 Underground`.
3. `EMAIL_SERVER=smtps://YOUR_GMAIL%40gmail.com:APP_PASSWORD@smtp.gmail.com:465`
   (the `@` in your address is written `%40`; remove spaces from the password).
4. `EMAIL_FROM="F1 Underground <YOUR_GMAIL@gmail.com>"`

## 3. Vercel (website)

1. Sign up at vercel.com with GitHub, **Add New → Project**, import
   `f1-underground`. Framework: Next.js (auto-detected). Deploy once; it will
   fail without variables, that's fine. Note the address, e.g.
   `https://f1-underground.vercel.app`.
2. Settings → Environment Variables: add every variable from `.env.example`
   (`AUTH_SECRET`: run `npx auth secret` and copy the value).
3. Redeploy.

## 4. Google sign-in

1. console.cloud.google.com → new project `F1 Underground`.
2. APIs & Services → OAuth consent screen: External, app name
   `F1 Underground`, your email; publish it (no review is needed for just
   name/email).
3. Credentials → Create credentials → OAuth client ID → Web application.
   Authorised redirect URI:
   `https://YOUR-APP.vercel.app/api/auth/callback/google`
4. Copy the client ID and secret → `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` in
   Vercel, redeploy.

## 5. First sign-in

Sign in with the email in `BOOTSTRAP_COMMISSIONER_EMAILS`; you become
commissioner. Then, on Admin:

- add the 2026 players as profiles (they claim them when they join);
- copy the join link into the group chat.

## Trying it on your own computer (optional, no accounts needed)

1. Install Node.js (the "LTS" button on nodejs.org) once.
2. Open this folder in a terminal (in GitHub Desktop: Repository → Open in
   Command Prompt / Terminal).
3. Run, one at a time: `npm install`, then `npm run db:local`, then
   `npm run dev:local`.
4. Open http://localhost:3000 and click **Local demo: skip sign-in**.
5. To stop it, press Ctrl+C in the terminal.

Sign-in links and invite emails are printed in the terminal instead of sent.
`npm run db:local` resets the demo data whenever you want a clean start.

## Checks

```
npm test        # league rules against a real Postgres (PGlite)
npm run lint
npm run build
```
