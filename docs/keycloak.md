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
  -s displayName="Continue with Google" \
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

Two steps are deliberately left to a human, because both involve a secret or an
account this tooling should not touch:

1. **Paste the Google client secret** into *Identity providers → google → Client
   Secret* in the admin console. Keeping it out of scripts keeps it out of shell
   history and CI logs.
2. **Register the broker callback** in the Google Cloud console, under the OAuth
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
