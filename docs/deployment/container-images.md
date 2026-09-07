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

## Two architectures, because one is not enough

The runner is `amd64`; the deploy host is `arm64`. The first published image was
`amd64` only, and the consequence is worth recording because it is quietly nasty:
Docker pulled it, printed a one-line platform-mismatch warning, started the
container, and the container crash-looped. A single-architecture image is a worse
failure than no image, because it looks like a successful deploy until the health
check gives up.

The build now covers `linux/amd64` and `linux/arm64`, and the published manifest
is **inspected** afterwards rather than assumed: the step fails if either platform
is missing from it.

Both are built on one amd64 runner with QEMU emulation, so the arm64 half is
slower than a native build. If that cost ever becomes the reason a release is
slow, the answer is a matrix over a native `arm64` runner rather than dropping a
platform.

## Tags and the digest

Each build is pushed under three references:

- the commit SHA, which never moves;
- the release tag, which identifies the release it went out with;
- `latest`, for convenience.

The release notes carry the **digest** of the manifest list, because a tag can be
repointed later and a digest cannot. A host that wants certainty about which bytes
it is running pulls the digest; the registry still hands it the right architecture.

The digest comes from the build's own metadata file. A multi-platform build leaves
no image in the local daemon, so there is nothing to `docker inspect` afterwards.

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

## Cost, measured

The two-architecture run took **6m25s** end to end on one amd64 runner, with the
arm64 half emulated. That is the whole workflow, not only the image: bundle,
package, code name, both images, release. It is slower than the single-platform
run it replaced and it is not slow enough to be worth a second runner yet.

## Verified

`v0.1.0-101.1` was pulled on the arm64 deploy host and started healthy, reporting
`arch=arm64` from a manifest carrying both platforms. The site answered 200 and
the journey smoke test planned 13 of 14 pairs with 0 failures against the pulled
image.

## The credential

The push authenticates with the workflow token over standard input. It never
reaches a command argument, an environment file, a log line or a layer.

Suggested articles: [deployment](README.md), [the journey smoke test](../verification/journey-smoke-test.md).
