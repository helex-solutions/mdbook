# Internal

**You are signed in.** This section is access-controlled: reaching it required a
login at `sso.helex.dev` and one of the `editor` or `admin` roles.

The rule that does it lives in `.mdbook/config.yml`:

```yaml
auth:
  issuer: https://sso.helex.dev/realms/mdbook
  clientId: owlexicon
  access: public                 # the rest of the site stays open
  rules:
    - path: internal/**
      access: [editor, admin]
```

Everything under `internal/` is withheld by the server from anyone without the
role, kept out of the search index at build time, and hidden from the sidebar
for readers who cannot open it. See `docs/auth-design.md` for the full model.
