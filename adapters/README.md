# Adapters

Thin wrappers that make existing Docker images compatible with the interop testing conventions.

## When to Use Adapters

**Adapters** are for implementations that already publish Docker images but don't follow the interop runner's conventions. This applies to both **relay** and **client** images.

An adapter is typically just a Dockerfile that:
1. Inherits from the upstream image (`FROM upstream-image:latest`)
2. Sets environment variables to map our conventions to theirs
3. Optionally adds a wrapper script if CLI translation is needed

For most cases, adapters are simpler than [builds](../builds/README.md) (which compile from source).

## Conventions

### Relay Conventions

The interop runner expects relay images to follow:

| Convention | Description |
|------------|-------------|
| `/certs/cert.pem` | TLS certificate path |
| `/certs/priv.key` | TLS private key path |
| `MOQT_PORT` | Port to listen on (default: 4443) |
| Exit code 0 | Success |
| Exit code non-zero | Failure |

### Client Conventions

The interop runner expects client images to follow:

| Convention | Description |
|------------|-------------|
| `RELAY_URL` | Relay URL (`https://` for WebTransport, `moqt://` for raw QUIC) |
| `TESTCASE` | Specific test to run (optional; runs all if not set) |
| `TLS_DISABLE_VERIFY=1` | Skip TLS certificate verification |
| TAP version 14 on stdout | Machine-parseable test output |
| Exit code 0 | All tests passed |
| Exit code 1 | One or more tests failed |

See [TEST-CLIENT-INTERFACE.md](../docs/TEST-CLIENT-INTERFACE.md) for the full client interface specification.

### When Do You Need an Adapter?

If an upstream image uses different environment variable names, certificate paths, or CLI conventions, an adapter bridges the gap.

## Directory Structure

```
adapters/
├── README.md              # This file
└── moxygen/
    ├── Dockerfile.relay   # Wraps upstream moxygen relay image
    └── run_endpoint.sh    # Optional CLI translation script
```

## Example: moxygen Adapter

Moxygen's official image expects certificates via environment variables, not the `/certs` mount. The adapter maps our convention to theirs:

```dockerfile
FROM ghcr.io/facebookexperimental/moqrelay:latest-amd64

# Map our /certs convention to moxygen's expected env vars
ENV CERT_FILE=/certs/cert.pem
ENV KEY_FILE=/certs/priv.key
ENV MOQ_PORT=4443

EXPOSE 4443/udp
```

## Adding an Adapter

1. Create a directory under `adapters/` matching the implementation name
2. Create a Dockerfile that inherits from the upstream image
3. Map environment variables or add wrapper scripts as needed
4. Register the adapter in `implementations.json` with a `build` section pointing to your Dockerfile

The `build.dockerfile` path in `implementations.json` is what `make build-adapters` uses to discover and build adapter images. Use `Dockerfile.relay` and `Dockerfile.client` to name your adapter Dockerfiles by role.

### Relay adapter registration

```json
"your-impl": {
  "roles": {
    "relay": {
      "docker": {
        "image": "your-impl-interop:latest",
        "build": {
          "dockerfile": "adapters/your-impl/Dockerfile.relay",
          "context": "adapters/your-impl"
        },
        "upstream_image": "original-image:latest"
      }
    }
  }
}
```

### Client adapter registration

```json
"your-impl": {
  "roles": {
    "client": {
      "docker": {
        "image": "your-impl-test-client:latest",
        "build": {
          "dockerfile": "adapters/your-impl/Dockerfile.client",
          "context": "adapters/your-impl"
        },
        "upstream_image": "original-client-image:latest"
      }
    }
  }
}
```

### Example: Client Adapter

If an implementation publishes a test client image that uses `TARGET_URL` instead of `RELAY_URL` and `SKIP_TLS_VERIFY` instead of `TLS_DISABLE_VERIFY`:

```dockerfile
FROM ghcr.io/example/moq-test-client:latest

# Map interop runner conventions to upstream env vars
ENTRYPOINT ["sh", "-c", "TARGET_URL=$RELAY_URL SKIP_TLS_VERIFY=$TLS_DISABLE_VERIFY exec /usr/local/bin/moq-test-client"]
```

## Building Adapters

```bash
# Build all adapters (reads build info from implementations.json)
make build-adapters

# Build a specific adapter directly
make build-moxygen-adapter

# Or with docker build
docker build -t moxygen-interop:latest -f adapters/moxygen/Dockerfile.relay adapters/moxygen/
```

`make build-adapters` discovers all adapter builds from `implementations.json` — any entry whose `build.dockerfile` starts with `adapters/` is built automatically. Adding a new adapter only requires creating the directory and registering it in `implementations.json`; no Makefile changes are needed.

## Adapters vs Builds

| Approach | When to Use | Works For |
|----------|-------------|-----------|
| **Adapters** | Upstream publishes working Docker images; you just need convention mapping | Relays and clients |
| **Builds** | You need to compile from source, test specific commits, or no upstream image exists | Relays and clients |

Adapters are simpler and faster since they reuse existing images. Use builds when you need source-level control. Both approaches work for any role (relay, client, etc.).
