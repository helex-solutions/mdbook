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
| `setup-realm.sh` | realm (incl. display name, login theme, email-as-username and **SMTP**), the parts of the **user profile** it owns, public client, roles, the roles claim mapper, one group per role, optional default role, optional test service account |
| `setup-idp.sh`   | identity providers (`google`, `github`, or `all`) |
| `setup-first-broker-login.sh` | a first-broker-login flow that **confirms by email** before linking a second provider to an existing account (needs realm SMTP) |
| `setup-all.sh`   | realm + identity providers |
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
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth client; a provider with no credentials is skipped, not half-created — so re-running without a secret never clobbers one already set |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | GitHub OAuth App, same skip-if-empty rule. **One App carries one callback URL**, so a second realm needs a second App |
| `KC_FIRST_BROKER_LOGIN_FLOW` | flow bound to every provider; point it at what `setup-first-broker-login.sh` creates |
| `KC_EMAIL_AS_USERNAME` | `true`: the email is the username, and both become admin-only in the user profile |
| `KC_PERSONAL_IDENTIFIER` | `required`, `optional` or empty (not managed): declares `personalIdentifier` — country + national code in one value, pattern-validated, shown by the `helex` theme as two fields |
| `KC_IDP_TRUST_EMAIL` | trust the address a provider returns as verified (`true` on the docs realms); marks a new reader's address verified, never skips the email confirmation for an existing account |

`.env` is **parsed, not sourced** — an unquoted value containing spaces would
otherwise execute as a command, and a config file should never be able to run
anything. Real environment variables take precedence over the file, so CI can
supply secrets without writing one.

**Realm settings are applied to an existing realm, not only a new one.**
Everything else here is create-if-absent, but a realm provisioned before SMTP
existed would otherwise never gain it — and a realm rebuilt *without* SMTP locks
out every invited reader, because the first-broker-login flow confirms linking
by email. The script reads the realm, puts back only the fields it owns, and
names what it changed; anything set by hand elsewhere in the realm survives.

`.env` holds secrets: it is gitignored, and worth `chmod 600`. Values must not
carry a trailing `# comment` — the value is taken verbatim to the end of the line.

> **A run rewrites the secret.** `setup-idp.sh` updates an existing provider from
> `.env`, so running it with a placeholder value replaces a real secret with the
> placeholder. Either supply the real value or leave it empty (empty skips the
> provider and leaves it untouched) — never a stand-in.

## After running

1. Register the broker callback with each provider — the script prints it:
   `<KC_PUBLIC_URL>/realms/<realm>/broker/<alias>/endpoint`. Google answers
   `Error 400: redirect_uri_mismatch` until it is added, per realm. A Google
   OAuth client can list several callbacks and so serve several realms; a GitHub
   OAuth App accepts exactly one, so each realm needs its own App.
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
