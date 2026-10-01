//! Desktop app plumbing: one process owns the store and serves MCP over
//! loopback HTTP; clients reach it directly or through the stdio bridge.
#![cfg(all(feature = "mcp-http", feature = "mcp-bridge"))]

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::Arc;

use aura::mcp::{link, serve_http};
use aura::Aura;

const TOKEN: &str = "test-token-123";

async fn start(dir: &std::path::Path) -> (u16, tokio::sync::oneshot::Sender<()>, Arc<Aura>) {
    let brain = Arc::new(Aura::open(dir.join("brain").to_str().unwrap()).unwrap());
    let kept = brain.clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let (stop, stopped) = tokio::sync::oneshot::channel::<()>();
    tokio::spawn(serve_http(brain, listener, TOKEN.into(), async {
        let _ = stopped.await;
    }));
    (port, stop, kept)
}

async fn raw_post(port: u16, host: &str, auth: Option<&str>) -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let body = r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#;
    let mut request = format!(
        "POST /mcp HTTP/1.1\r\nHost: {host}\r\nContent-Type: application/json\r\n\
         Accept: application/json, text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    );
    if let Some(auth) = auth {
        request.push_str(&format!("Authorization: {auth}\r\n"));
    }
    request.push_str("\r\n");
    request.push_str(body);
    let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .unwrap();
    stream.write_all(request.as_bytes()).await.unwrap();
    let mut response = String::new();
    let _ = stream.read_to_string(&mut response).await;
    response.lines().next().unwrap_or_default().to_string()
}

#[tokio::test]
async fn http_endpoint_requires_token_and_loopback_host() {
    let dir = tempfile::tempdir().unwrap();
    let (port, _stop, _) = start(dir.path()).await;
    let ok_host = format!("127.0.0.1:{port}");
    let bearer = format!("Bearer {TOKEN}");
    assert!(raw_post(port, &ok_host, None).await.contains("401"));
    assert!(raw_post(port, &ok_host, Some("Bearer wrong"))
        .await
        .contains("401"));
    assert!(raw_post(port, "evil.example:80", Some(&bearer))
        .await
        .contains("403"));
    // Right token and host reach MCP (which wants an initialize first).
    let status = raw_post(port, &ok_host, Some(&bearer)).await;
    assert!(
        !status.contains("401") && !status.contains("403"),
        "{status}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn two_bridges_share_one_store() {
    let dir = tempfile::tempdir().unwrap();
    let (port, _stop, brain) = start(dir.path()).await;
    let home = dir.path().join("home");
    std::env::set_var("AURA_HOME", &home);
    link::write(&link::Link {
        port,
        token: TOKEN.into(),
        app: None,
    })
    .unwrap();

    let writer = tokio::task::spawn_blocking({
        let home = home.clone();
        move || {
            session(
                &home,
                "claude-desktop",
                r#"{"name":"store","arguments":{"content":"My sister lives in Lviv","source_type":"recorded"}}"#,
            )
        }
    })
    .await
    .unwrap();
    assert!(!writer.contains("\"isError\":true"), "{writer}");
    // The write is labelled with the app that made it (display only: a
    // model's claim stays model-relayed).
    let stored = brain.search(Some("Lviv"), None, None, None, None, None, None, None);
    assert_eq!(stored.len(), 1);
    assert_eq!(
        stored[0].metadata.get("client").map(String::as_str),
        Some("claude-desktop")
    );
    assert_eq!(
        stored[0]
            .metadata
            .get("relayed_by_model")
            .map(String::as_str),
        Some("true")
    );

    let reader = tokio::task::spawn_blocking(move || {
        session(
            &home,
            "cursor",
            r#"{"name":"recall","arguments":{"query":"Where does my sister live?"}}"#,
        )
    })
    .await
    .unwrap();
    assert!(reader.contains("Lviv"), "{reader}");
}

/// One client session through the bridge: initialize, one tool call; the
/// tool call's response line.
fn session(home: &std::path::Path, client: &str, call: &str) -> String {
    let mut child = Command::new(env!("CARGO_BIN_EXE_aura-bridge"))
        .args(["--client", client])
        .env("AURA_HOME", home)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let mut send = |line: &str| {
        stdin.write_all(line.as_bytes()).unwrap();
        stdin.write_all(b"\n").unwrap();
        stdin.flush().unwrap();
    };
    let mut read_id = |id: u32| -> String {
        let mut line = String::new();
        loop {
            line.clear();
            assert!(stdout.read_line(&mut line).unwrap() > 0, "bridge closed");
            if line.contains(&format!("\"id\":{id}")) {
                return line.clone();
            }
        }
    };
    send(
        r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}"#,
    );
    let init = read_id(1);
    assert!(init.contains("serverInfo"), "{init}");
    send(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#);
    send(&format!(
        r#"{{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{call}}}"#
    ));
    let response = read_id(2);
    let _ = child.kill();
    let _ = child.wait();
    response
}
