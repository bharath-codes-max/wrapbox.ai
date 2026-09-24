# Tika sidecar (Tier 2 extractor `wrapbox.tika`)

The Wrapbox runtime never links PDF, legacy Office, mail or archive parsers.
Those formats are handed to an isolated Apache Tika 4 server on loopback and
read back as a recursive-metadata tree (`PUT /rmeta/text`). The client lives in
`runtime/src/extract/tika.ts`.

## Run

```sh
cd ops/tika
docker compose up -d
```

The service binds **only** `127.0.0.1:9998`, runs on an `internal` network
(no egress), with `mem_limit: 2g`, `cpus: 2`, a read-only root filesystem, all
capabilities dropped, and `tika-config.xml` mounted read-only. Parsing happens
in a forked child JVM (`-Xmx1g`) that is killed after 30 s per task and
restarted without limit (`maxRestarts=-1`, `maxFiles=1000`).

If your Docker Engine refuses to publish ports for a container attached only
to an `internal` network (older engines; see moby/moby#36174), remove
`internal: true` and instead deny egress from the container's subnet with a
`DOCKER-USER` iptables rule. Do not widen the publish address.

## Health check

From the host:

```sh
curl -s http://127.0.0.1:9998/version
# Apache Tika 4.0.0
```

The runtime performs the same probe (`GET /version`, 1.5 s budget) in
`available()`; `wrapboxd capabilities` reports the result. The compose file
also carries a container-level healthcheck (`docker compose ps` shows
`healthy`).

To point the runtime elsewhere (tests, a second instance) set
`WRAPBOX_TIKA_URL`, or `services.tika.url` in `WRAPBOX_HOME/config.json`.
A **non-loopback URL is refused** unless `services.tika.allowRemote` is
`true` in that config — every outbound body would otherwise be copied to that
host, and that is a tenant decision, not a default.

## When the sidecar is absent

Nothing changes in the runtime's safety posture. `available()` returns
`{ ok: false, reason }`, the capability report shows the extractor as
unavailable, and PDF / PPTX / archive bodies keep today's **fail-closed**
behaviour: they are reported as `UNINSPECTABLE` and a clause that needs their
content stays `UNDERSTOOD_ONLY` rather than being claimed as enforced.
The sidecar adds inspection; it never adds a way for content to pass
uninspected.

## What is real and what is simulated

Real: the container hardening, the fork limits, the HTTP client, the status
and depth mapping, the loopback rule. Simulated: nothing — but the client has
only been exercised against a fake server in `runtime/src/tests/tika.test.ts`
and needs a run against the live image before the format list in the registry
descriptor is treated as verified.
