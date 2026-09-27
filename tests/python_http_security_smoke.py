"""`aura serve` must require a key off-loopback and reject unauthenticated calls."""

import os
import tempfile

with tempfile.TemporaryDirectory() as directory:
    os.environ["AURA_BRAIN_PATH"] = directory
    os.environ["AURA_API_KEY"] = "smoke-test-key"

    from fastapi.testclient import TestClient

    import aura.mcp_http as server

    client = TestClient(server.app)
    assert client.get("/health").status_code == 200
    assert client.get("/stats").status_code == 401
    assert client.get("/stats", headers={"Authorization": "Bearer wrong"}).status_code == 401
    stored = client.post(
        "/store",
        json={"content": "hello"},
        headers={"X-API-Key": "smoke-test-key"},
    )
    assert stored.status_code == 200, stored.text
    stats = client.get("/stats", headers={"Authorization": "Bearer smoke-test-key"})
    assert stats.status_code == 200, stats.text
    foreign = client.get("/health", headers={"Origin": "https://example.invalid"})
    assert "access-control-allow-origin" not in foreign.headers

    del os.environ["AURA_API_KEY"]
    try:
        server.run_http(directory, host="0.0.0.0")
    except SystemExit as error:
        assert "Refusing" in str(error)
    else:
        raise AssertionError("non-loopback bind without a key was allowed")

    server.get_brain().close()

print("python http security smoke passed")
