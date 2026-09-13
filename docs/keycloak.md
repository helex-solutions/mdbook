# Setting up a Keycloak realm for mdbook

What mdbook needs from an identity provider is small: a **public client** with the
site's callback registered, and **roles in a claim**.

> **Scripts:** [`deploy/keycloak/`](../deploy/keycloak/) does all of this from a
> `.env` — `cp .env.sample .env && ./setup-all.sh --with-idp google`. The commands
> below are the same steps spelled out, for adapting by hand or for a Keycloak you
> reach only through `kcadm`.

The examples use realm `mdbook`, client `owlexicon` and site
`https://tx.helex.dev/mdbook` — the [reference deployment](deployment.md#reference-deployment).

## 1. Realm and client

```sh
KC=/opt/keycloak/bin/kcadm.sh
$KC config credentials --server http://localhost:8080 --realm master \
  --user "$KC_BOOTSTRAP_ADMIN_USERNAME" --password "$KC_BOOTSTRAP_ADMIN_PASSWORD"

R=mdbook
SITE=https://tx.helex.dev/mdbook

$KC create realms -s realm=$R -s enabled=true -s displayName=mdbook \
  -s ssoSessionIdleTimeout=1800 -s ssoSessionMaxLifespan=36000

$KC create clients -r $R \
  -s clientId=owlexicon -s name="Owlexicon docs" -s enabled=true \
  -s publicClient=true -s standardFlowEnabled=true \
  -s directAccessGrantsEnabled=false \
  -s 'redirectUris=["'"$SITE"'/auth/callback"]' \
  -s 'webOrigins=["https://tx.helex.dev"]' \
  -s 'attributes."pkce.code.challenge.method"=S256'
```

The redirect URI is **`<site base>/auth/callback`** — exactly the path `mdbook serve`
listens on. A public client is correct: the code exchange happens server-side in
`serve`, and PKCE is what protects it. (A confidential client also works; set
`AUTH_OIDC_CLIENT_SECRET` on the container.)

**The user profile is realm state too.** `setup-realm.sh` owns two parts of it,
switched by `.env`: `KC_EMAIL_AS_USERNAME=true` makes email and username
admin-only, and `KC_PERSONAL_IDENTIFIER` (`required` on `docs-tx`, `optional` on
`docs-emr`) declares `personalIdentifier`. It reads the live profile and writes
back only those declarations, so hand-added attributes survive and a re-run that
changes nothing writes nothing.

**Saved events** are owned the same way. Keycloak's log listener writes a
successful login or account link at DEBUG, so the container log only ever shows
failures; `KC_SAVE_EVENTS=true` keeps them in the realm (*Events → User events*
in the console) for `KC_EVENTS_EXPIRATION_DAYS`, 90 by default — they carry IP
addresses, so they expire. Both docs realms save events.

## 2. Roles and the claim

mdbook checks **role names**, so the token has to carry them. Create the roles on
the client, then a mapper that puts them in a `roles` claim:

```sh
CID=$($KC get clients -r $R -q clientId=owlexicon --fields id --format csv --noquotes)
for role in viewer editor admin; do
  $KC create clients/$CID/roles -r $R -s name=$role
done

$KC create clients/$CID/protocol-mappers/models -r $R \
  -s name=roles -s protocol=openid-connect \
  -s protocolMapper=oidc-usermodel-client-role-mapper \
  -s 'config."claim.name"=roles' \
  -s 'config."jsonType.label"=String' \
  -s 'config.multivalued=true' \
  -s 'config."usermodel.clientRoleMapping.clientId"=owlexicon' \
  -s 'config."access.token.claim"=true' \
  -s 'config."id.token.claim"=true'
```

`roles` is mdbook's default claim. Realm roles or a different claim work too —
point `auth.roleClaims` (or `AUTH_ROLE_CLAIMS`) at the path, e.g.
`realm_access.roles` or `resource_access.owlexicon.roles`; several comma-separated
paths are unioned.

Groups keep assignment manageable — one group per role, membership granting it:

```sh
for role in viewer editor admin; do
  $KC create groups -r $R -s name=mdbook-$role
  GID=$($KC get groups -r $R -q search=mdbook-$role --fields id,name --format csv --noquotes \
        | grep "mdbook-$role" | cut -d, -f1)
  $KC add-roles -r $R --gid "$GID" --cclientid owlexicon --rolename $role
done
```

## 3. Federated login (Google)

Add Google as an identity provider so readers sign in with an account they already
have. Keycloak's generic `oidc` provider against Google's endpoints gives the most
control over the button label and flows:

```sh
$KC create identity-provider/instances -r $R \
  -s alias=google -s providerId=oidc -s enabled=true \
  -s displayName="Google" \
  -s firstBrokerLoginFlowAlias="first broker login" \
  -s 'config.issuer=https://accounts.google.com' \
  -s 'config.authorizationUrl=https://accounts.google.com/o/oauth2/v2/auth' \
  -s 'config.tokenUrl=https://oauth2.googleapis.com/token' \
  -s 'config.userInfoUrl=https://openidconnect.googleapis.com/v1/userinfo' \
  -s 'config.jwksUrl=https://www.googleapis.com/oauth2/v3/certs' \
  -s 'config.useJwksUrl=true' -s 'config.validateSignature=true' \
  -s 'config.clientAuthMethod=client_secret_post' \
  -s 'config.defaultScope=openid profile email' \
  -s 'config.syncMode=IMPORT' \
  -s 'config.clientId=<google-oauth-client-id>'
```

The provider is created with `storeToken: true` (so a session can be refreshed
against Google), Google's discovery URL alongside the explicit endpoints, and
three identity-provider mappers recording `sub`, `amr` and `acr` as user
attributes — who the user is at the provider, and how they authenticated.

The display name is the **bare provider name**. It is not only button text:
Keycloak also puts it into the account-link confirmation email (§3b), where
"Continue with Google" reads as a sentence fragment. The `helex` login theme adds
"Continue with" on the button itself.

The **client secret comes from `.env`**, like every other credential these
scripts use — set `GOOGLE_CLIENT_SECRET` and re-run `setup-idp.sh google`. `.env`
is gitignored and should be `chmod 600`; a provider with no secret is skipped
rather than half-created, so re-running without one never clobbers a value that
is already in place.

One step stays with a human, because it needs an account this tooling should not
touch:

1. **Register the broker callback** in the Google Cloud console, under the OAuth
   client's *Authorized redirect URIs*:

   ```
   https://sso.helex.dev/realms/<realm>/broker/google/endpoint
   ```

   Each realm brokering the same Google client needs its own entry — one OAuth
   client can serve several realms, it just needs every callback listed. Google
   answers `Error 400: redirect_uri_mismatch` until it is added, which is the
   error to expect while testing, not a Keycloak misconfiguration. Once the URI
   is registered, the account chooser appears and only the secret remains.

**Copying a provider between realms.** The admin API **masks** `clientSecret`
(it reads back as `**********`), so a provider cannot be cloned complete: copy
every other field, then paste the secret once in the target realm. Writing the
masked string back would set that literal value as the secret. Copying it at the
database level works but needs a Keycloak restart to clear the config cache —
disruptive on a shared instance, and rarely worth it for one field.

**Realm-specific flows do not travel.** A `postBrokerLoginFlowAlias` naming a
flow the target realm lacks breaks every login through that provider, so drop it
unless the flow exists there too (the reference `emr` realm points at an
IP-allow-list flow that a public docs site should not inherit blindly).

> **A federated user arrives with no roles.** Signing in with Google proves who
> someone is, not what they may read, so a brand-new Google user meets
> `access: authenticated` but gets **403** on a role-gated section. Choose one:
> add a role to the realm's *default roles* (open-by-default: everyone who can log
> in gets `viewer`), assign groups per user, or map a Google claim (e.g. a hosted
> domain) to a role with an identity-provider mapper.

## 3a. Federated login (GitHub)

GitHub is **OAuth2, not OpenID Connect** — no issuer, no JWKS, no `id_token` — so
it cannot go through the generic `oidc` provider the Google recipe uses. Keycloak
ships a built-in `github` provider that already knows the endpoints, and stock
login themes give it the Octocat:

```sh
GITHUB_CLIENT_ID=… GITHUB_CLIENT_SECRET=… ./setup-idp.sh github
```

Three things follow from GitHub not being OIDC:

- **No `sub`/`amr`/`acr` mappers.** Those claims do not exist at GitHub, and
  `oidc-user-attribute-idp-mapper` is the wrong mapper type for a `github`
  provider in any case. `setup-idp.sh` deliberately creates none for it.
- **`user:email` is not optional.** GitHub omits the address from the profile
  when the user has made it private; the scope is what lets Keycloak read the
  verified primary address from `/user/emails`. Without it an identity arrives
  with no email at all and cannot be matched to a pre-created reader.
- **The address is verified at GitHub, not by Keycloak.** Keycloak takes the
  primary address and does not check its `verified` flag, relying on GitHub's
  rule that a primary address must be verified. `KC_IDP_TRUST_EMAIL=true` marks
  it verified on import; it does not stand in for the confirmation in §3b.

**In the GitHub UI** — organisation-owned, so it outlives one person's account:
*Organization settings → Developer settings → OAuth Apps → New OAuth App*, with
**Homepage URL** `https://docs.helex.org` and **Authorization callback URL**

```
https://sso.helex.dev/realms/<realm>/broker/github/endpoint
```

Then *Generate a new client secret* and copy it — GitHub shows it once.

Unlike Google, **an OAuth App carries exactly one callback URL**, so one App
cannot serve two realms whose paths differ (`/realms/docs-tx/` vs
`/realms/docs-emr/`). A second realm needs a second App, or a GitHub *App*,
which allows ten.

> **GitHub login cannot be restricted to an organisation.** Any GitHub account on
> earth completes the flow successfully. On a role-gated site that is contained
> by the role — the reader still needs `mdbook-viewer` — but it means `access:`
> must not be relaxed to `authenticated` while GitHub is enabled, and a realm
> default role would effectively publish the site.

## 3b. Admitting a reader who was invited before they logged in

A reader here is invited by being **created by email and put in
`mdbook-<role>` before they ever log in** — the role is the invitation. They may
then arrive through more than one provider: Google today, GitHub tomorrow.
Keycloak matches those on email.

The built-in `first broker login` flow asks the person to confirm that link, by
email. These realms had no SMTP, so that path dead-ended, and the flow was
edited to link **silently** instead — *Handle Existing Account* DISABLED plus
`idp-auto-link`. Silent linking means whoever can make any provider assert an
address owns the account at that address, roles included.

With SMTP configured that trade is unnecessary, and the flow now confirms:

```sh
KC_REALM=docs-tx ./setup-first-broker-login.sh
KC_REALM=docs-tx KC_FIRST_BROKER_LOGIN_FLOW="docs-tx first broker login" \
  KC_IDP_TRUST_EMAIL=true ./setup-idp.sh google github
```

The script makes four edits to a copy of the built-in flow, and **all four
matter**:

1. *Create User If Unique* is raised **above** *Handle Existing Account*.
   Alternatives run in index order; reversed, a brand-new reader is offered the
   existing-account branch. (The live `docs-emr` flow had exactly this
   inversion, harmless only because the branch was disabled.)
2. *Handle Existing Account* → **ALTERNATIVE** — confirm, then verify by email.
3. *Verify Existing Account by Re-authentication* → **DISABLED**. Its only
   execution is a password form and nobody in these realms has a password; it is
   a dead end a reader can pick by mistake.
4. **`idp-auto-link` is removed.** This is the one that decides whether any of
   the rest means anything: it sits as a later ALTERNATIVE, so a declined or
   expired confirmation falls through and links anyway.

> **SMTP is a hard prerequisite.** Bind this flow on a realm without a working
> sender and every invitation dead-ends with no way back. The script warns when
> `smtpServer` is empty (`setup-realm.sh` writes it from the `SMTP_*`
> variables). Verify delivery with
> `PUT /admin/realms/<realm>/users/<id>/execute-actions-email` against a real
> reader — a 204 means Keycloak's own mail code handed the message over. The
> built-in `testSMTPConnection` sends to the **calling admin's** address, and
> the `master` admin has none, so it fails with a bare 500 that says nothing
> about the relay.

**`trustEmail` does not weaken this.** Keycloak 26.4's
`IdpEmailVerificationAuthenticator` never reads it: it lets the step fall
through only when the realm has no SMTP, or when the reader changed the email or
username on the review page — which these realms prevent, since both fields are
admin-only. `trustEmail` only marks a *new* reader's imported address verified.

Creating the flow does not bind it: binding is per provider
(`firstBrokerLoginFlowAlias`), which is why `setup-idp.sh` takes
`KC_FIRST_BROKER_LOGIN_FLOW`. Run the flow script first.

**What this does not do.** It never matches on `idp_sub`. Google's subject is a
21-digit account id and GitHub's is the numeric GitHub user id — different
namespaces, so equality across them is a coincidence, and merging on it would be
an account-takeover primitive. Two accounts holding the same string are fine;
`idp_sub` is a per-provider subject, not an identity.

## 4. Verifying without a browser

A service account gives a real, signed token to test enforcement with — no
passwords, no interactive flow:

```sh
$KC create clients -r $R -s clientId=mdbook-test -s enabled=true \
  -s publicClient=false -s serviceAccountsEnabled=true -s standardFlowEnabled=false
# …add the same roles mapper as in §2, then grant the service-account user a role:
TID=$($KC get clients -r $R -q clientId=mdbook-test --fields id --format csv --noquotes)
SA=$($KC get clients/$TID/service-account-user -r $R --fields id --format csv --noquotes)
$KC add-roles -r $R --uid "$SA" --cclientid owlexicon --rolename editor
```

```sh
TOKEN=$(curl -s -X POST \
  -d grant_type=client_credentials -d client_id=mdbook-test \
  --data-urlencode "client_secret=$SECRET" \
  https://sso.helex.dev/realms/mdbook/protocol/openid-connect/token | jq -r .access_token)

curl -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" \
  https://tx.helex.dev/mdbook/internal/notes
```

Expected results, and what each one proves:

| Request | Expect | Proves |
|---|---|---|
| anonymous, protected page | `302` → `/auth/login` | the gate is on |
| `/auth/login` | `302` → Keycloak with `code_challenge_method=S256` | PKCE, correct redirect URI |
| token with a granted role | `200` | signature + issuer + claim mapping |
| token with a role that is not granted | `403` + the denied page | authorization, not just authentication |
| forged/altered token | `302` (treated as anonymous) | signatures are actually checked |
| any public page | `200` | the gate is scoped to the rules |

## 5. mdbook side

```yaml
auth:
  issuer: https://sso.helex.dev/realms/mdbook
  clientId: owlexicon
  access: public
  rules:
    - path: internal/**
      access: [editor, admin]
```

The session-signing key is the one secret `serve` needs; keep it in the
environment, not in config:

```sh
AUTH_SESSION_SECRET=$(openssl rand -hex 32)
```

Rotating it signs everyone out — which is also how you revoke every session at
once.
