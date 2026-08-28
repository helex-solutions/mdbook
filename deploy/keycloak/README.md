# Keycloak provisioning for an mdbook site

Recreate a realm from scratch instead of remembering which buttons were clicked.
The scripts talk to the Keycloak admin REST API and follow the same conventions
(and variable names) as the `emr-keycloak` scripts, so one `.env` can drive both.

```sh
cp .env.sample .env      # fill in — .env is gitignored
./setup-all.sh --with-idp google
```

| Script | Does |
|---|---|
| `setup-realm.sh` | realm, public client, roles, the roles claim mapper, one group per role, optional default role, optional test service account |
| `setup-idp.sh`   | identity providers (`google`, or `all`) |
| `setup-all.sh`   | both |
| `lib.sh`         | `.env` loading, admin token, REST helpers |

Everything is **re-runnable**: existing objects are reported and left alone, so
the scripts double as a description of the realm's current state.

## Configuration

All variables live in [`.env.sample`](.env.sample). The ones that matter most:

| Variable | Meaning |
|---|---|
| `KC_URL` | admin API endpoint (may be private, e.g. `http://localhost:18503`) |
| `KC_PUBLIC_URL` | public issuer base, when it differs from `KC_URL` |
| `KC_ADMIN`, `KC_ADMIN_PASS` | admin credentials |
| `KC_REALM` | realm name |
| `SITE_URL` | public base of the mdbook site; the client's redirect URI is `<SITE_URL>/auth/callback` |
| `MDBOOK_CLIENT_ID` | the public client mdbook uses (default `owlexicon`) |
| `MDBOOK_ROLES` | roles to create — **quote it**, it contains spaces |
| `MDBOOK_DEFAULT_ROLE` | role granted to everyone who can log in; empty grants nothing |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth client; a provider with no credentials is skipped, not half-created |

`.env` is **parsed, not sourced** — an unquoted value containing spaces would
otherwise execute as a command, and a config file should never be able to run
anything. Real environment variables take precedence over the file, so CI can
supply secrets without writing one.

## After running

1. Register the broker callback with each provider — the script prints it:
   `<KC_PUBLIC_URL>/realms/<realm>/broker/google/endpoint`. Google answers
   `Error 400: redirect_uri_mismatch` until it is added, per realm.
2. Decide what a federated user may read. **They arrive with no roles**, so
   Google login alone yields 403 on a role-gated section — set
   `MDBOOK_DEFAULT_ROLE`, assign the `mdbook-*` groups, or map a provider claim
   to a role.
3. Point the site at the realm:

   ```yaml
   auth:
     issuer: https://sso.helex.dev/realms/mdbook
     clientId: owlexicon
   ```

Verifying enforcement without a browser, and the full model, are in
[`../../docs/keycloak.md`](../../docs/keycloak.md) and
[`../../docs/auth-design.md`](../../docs/auth-design.md).
