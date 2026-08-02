# GitHub Pages rollback

The Pages workflow accepts a `deploy_ref` input. A manual run checks out that
tag, branch, or SHA and deploys the exact contents of its `outputs/` folder;
it does not rewrite `main`.

## Roll back this release

1. Open **Actions → Deploy The Crown to GitHub Pages → Run workflow**.
2. Set `deploy_ref` to `rollback-pre-integrity-03c7f64`.
3. Run the workflow and wait for the `deploy` job to turn green.

CLI equivalent:

```sh
gh workflow run pages.yml -f deploy_ref=rollback-pre-integrity-03c7f64
```

## Restore the latest release

Run the same workflow with `deploy_ref` set to `main`:

```sh
gh workflow run pages.yml -f deploy_ref=main
```

After either operation, verify `https://yan396.github.io/the-crown-demo/`
returns HTTP 200 and that the hidden title diagnostics show the expected
seven-character commit.
