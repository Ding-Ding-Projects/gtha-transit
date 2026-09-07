# Container images built by the release workflow

The release workflow builds the web service as a container image from the same
commit the release is cut from, and pushes it to the GitHub Container Registry. A
host then deploys by pulling rather than by rebuilding from a source tarball.

## What is published, and what is not

**The web service is.** Everything its image needs is in this repository, so a
runner can build it from a checkout and nothing else.

**The routing API is not, and cannot be.** Its image needs three generated
indexes that this repository carries only as placeholders:

| File | In the repository | Needed by the image |
| --- | ---: | ---: |
| `data/stops.json` | 240 bytes | ~17.5 MB |
| `data/route-patterns.json` | 546 bytes | ~30.5 MB |
| `data/routes.json` | 394 bytes | ~0.5 MB |

Those are produced by `scripts/data/build-stop-index.py` from twelve
checksum-validated official GTFS archives. A runner could in principle download
all twelve and rebuild them on every release, but that is not what happens today,
and publishing an API image without them would ship a container that starts and
answers nothing. So the workflow builds one image and says so rather than
appearing to build both.

## Tags and the digest

Each build is pushed under three references:

- the commit SHA, which never moves;
- the release tag, which identifies the release it went out with;
- `latest`, for convenience.

The release notes carry the **digest**, because a tag can be repointed later and a
digest cannot. A host that wants certainty about which bytes it is running pulls
the digest.

## Deploying

Set `WEB_IMAGE` to a registry reference and the Compose project pulls it:

```
WEB_IMAGE=ghcr.io/<owner>/gtha-transit-web:<tag> docker compose pull
WEB_IMAGE=ghcr.io/<owner>/gtha-transit-web:<tag> docker compose up -d
```

Leaving `WEB_IMAGE` unset keeps the local build, which is what a machine without
registry access still needs. Both paths produce the same service; only where the
image came from differs.

The routing API is unaffected either way: it keeps its existing local build, and
the credential it reads must be owned by the uid the container runs as, because
that container drops every capability and therefore has no `CAP_DAC_OVERRIDE` to
fall back on.

## The credential

The push authenticates with the workflow token over standard input. It never
reaches a command argument, an environment file, a log line or a layer.

Suggested articles: [deployment](README.md), [the journey smoke test](../verification/journey-smoke-test.md).
