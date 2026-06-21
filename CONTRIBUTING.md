# Contributing

Thanks for helping out! 🏄 This is a small, friendly project — most contributions are
to the **web app** (`app/`), which is plain vanilla JS with no build step. Start with
[`app/CLAUDE.md`](app/CLAUDE.md) for how the app fits together.

## Workflow — please use a pull request

`main` is protected: **no direct pushes**. Contribute via a branch + PR so CI runs and
changes get a quick look.

```sh
# 1. fork (or branch, if you have access), then:
git switch -c my-change

# 2. make your change, commit (hooks run automatically — see below)
git commit -m "feat(app): ..."

# 3. push your branch and open a pull request
git push -u origin my-change
```

CI runs the (mocked, offline) test suites on every PR; they must pass to merge.

## One-time setup: pre-commit hooks

We use [pre-commit](https://pre-commit.com) for tidy commits and to run the tests
before you push:

```sh
pip install pre-commit
pre-commit install --install-hooks   # sets up the commit + push hooks
```

What the hooks do: block direct commits to `main`, catch merge-conflict markers and
oversized files, check YAML/JSON, fix trailing whitespace / missing final newlines,
and run the **Python + JS test suites before each push**.

## Running the tests yourself

No dependencies needed:

```sh
python3 -m unittest discover -s tests      # Python (client, watcher, release logic)
node --test app/test/*.test.js             # JS (app)
```

Tests are fully mocked — they never hit the live Lagoon API, so they're fast and
deterministic. Add tests the same way (pass a stub `fetch` or inject data).

## House rules

- **Keep the app dependency-free** — no npm packages, no bundler, no framework. Plain
  ES-module `.js` the browser runs as-is.
- **No secrets in the repo** (it's public). The app stores only a Lagoon access token,
  on the device, never committed.
- **No card payments, ever.** Browsing + managing your own bookings only.
- When you add/rename a file or change cached code, **bump the version**: `CACHE` in
  `app/sw.js` *and* `APP_RELEASE` in `app/js/config.js`, together (see `app/CLAUDE.md`).

Questions? Open an issue, or email dave@dave-smith.co.uk.
