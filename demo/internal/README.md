# Internal

This section is public today. It is the section a deployment would restrict once
an identity provider is configured — see the repository's `docs/auth-design.md`.

With `auth:` configured, a rule such as:

```yaml
auth:
  rules:
    - path: internal/**
      access: [editor, admin]
```

would put every page here behind a login, keep them out of the search index, and
hide them from the sidebar for readers without the role.
