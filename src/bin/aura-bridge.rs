//! Aura stdio bridge.
//!
//! Clients that can only start a local process (Claude Desktop, some IDEs)
//! run this binary. It reads the running desktop app's link file, starts the
//! app when it is closed, and forwards MCP messages between stdio and the
//! app's loopback HTTP endpoint. One app owns the store; every client shares
//! it.
//!
//! As `aura-bridge hook --client NAME` it is an agent hook command (Claude
//! Code `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`): it reads
//! the hook event from stdin and posts it to the app's journal. It never
//! blocks or changes the agent: no output, exit 0, and the event is dropped
//! when Aura is not running.
//!
//! # Usage
//!     aura-bridge [--client NAME]
//!     aura-bridge hook --client NAME

use std::time::Duration;

use anyhow::{bail, Context};
use aura::mcp::link;
use rmcp::transport::{
    streamable_http_client::StreamableHttpClientTransportConfig, IntoTransport,
    StreamableHttpClientTransport, Transport,
};
use rmcp::{RoleClient, RoleServer};

const START_WAIT: Duration = Duration::from_secs(20);

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(tracing::Level::WARN.into()),
        )
        .with_writer(std::io::stderr)
        .init();

    let client = client_name();
    if std::env::args().nth(1).as_deref() == Some("hook") {
        hook::run(client.as_deref()).await;
        return Ok(());
    }
    let link = reach_app().await?;
    let mut uri = format!("http://127.0.0.1:{}/mcp", link.port);
    if let Some(client) = &client {
        uri.push_str("?client=");
        uri.push_str(client);
    }
    let mut config = StreamableHttpClientTransportConfig::with_uri(uri);
    config.auth_header = Some(link.token);
    let mut remote = StreamableHttpClientTransport::from_config(config);
    let mut local = IntoTransport::<RoleServer, _, _>::into_transport(rmcp::transport::stdio());

    loop {
        tokio::select! {
            message = Transport::<RoleServer>::receive(&mut local) => match message {
                Some(message) => Transport::<RoleClient>::send(&mut remote, message).await?,
                None => break,
            },
            message = Transport::<RoleClient>::receive(&mut remote) => match message {
                Some(message) => Transport::<RoleServer>::send(&mut local, message).await?,
                None => bail!("Aura closed the connection"),
            },
        }
    }
    let _ = Transport::<RoleClient>::close(&mut remote).await;
    Ok(())
}

fn client_name() -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    let name = args
        .iter()
        .position(|a| a == "--client")
        .and_then(|i| args.get(i + 1))?;
    // Only a plain identifier goes into the URL.
    name.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        .then(|| name.clone())
}

/// The link of a running app, starting the app first when needed.
async fn reach_app() -> anyhow::Result<link::Link> {
    if let Some(link) = link::read() {
        if alive(link.port).await {
            return Ok(link);
        }
    }
    let app = link::read()
        .and_then(|l| l.app)
        .or_else(installed_app)
        .context("Aura is not running and its app was not found. Open Aura once.")?;
    std::process::Command::new(&app)
        .arg("--background")
        .spawn()
        .with_context(|| format!("could not start {app}"))?;
    let started = tokio::time::Instant::now();
    while started.elapsed() < START_WAIT {
        tokio::time::sleep(Duration::from_millis(250)).await;
        if let Some(link) = link::read() {
            if alive(link.port).await {
                return Ok(link);
            }
        }
    }
    bail!("Aura did not start within {} s", START_WAIT.as_secs())
}

async fn alive(port: u16) -> bool {
    tokio::net::TcpStream::connect(("127.0.0.1", port))
        .await
        .is_ok()
}

/// The app next to this bridge (installers put both in one folder).
fn installed_app() -> Option<String> {
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let name = if cfg!(windows) { "Aura.exe" } else { "Aura" };
    let path = dir.join(name);
    path.exists().then(|| path.to_string_lossy().into_owned())
}

mod hook {
    //! Agent hook events for the app's journal.

    use std::time::Duration;

    use aura::mcp::link;
    use serde_json::Value;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// Text fields are cut to this many characters: enough to read, small
    /// enough that a large file read never bloats the journal.
    const MAX_TEXT: usize = 16_000;

    pub async fn run(client: Option<&str>) {
        let mut input = String::new();
        if tokio::io::stdin().read_to_string(&mut input).await.is_err() {
            return;
        }
        let Ok(mut event) = serde_json::from_str::<Value>(&input) else {
            return;
        };
        prepare(&mut event);
        let Some(link) = link::read() else { return };
        let body = event.to_string();
        let _ = tokio::time::timeout(Duration::from_secs(2), post(&link, client, &body)).await;
    }

    /// Add the assistant's reply to a `Stop` event, stamp the time, and cut
    /// long fields.
    pub fn prepare(event: &mut Value) {
        let Some(map) = event.as_object_mut() else {
            return;
        };
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);
        map.insert("received_at".into(), now.into());
        if map.get("hook_event_name").and_then(Value::as_str) == Some("Stop")
            && map
                .get("last_assistant_message")
                .and_then(Value::as_str)
                .is_none_or(|t| t.trim().is_empty())
        {
            if let Some(path) = map.get("transcript_path").and_then(Value::as_str) {
                let reply = last_assistant_text(path);
                if !reply.is_empty() {
                    map.insert("last_assistant_message".into(), reply.into());
                }
            }
        }
        for key in ["tool_input", "tool_response"] {
            if let Some(value) = map.get_mut(key) {
                let text = match &*value {
                    Value::String(s) => s.clone(),
                    other => other.to_string(),
                };
                if text.chars().count() > MAX_TEXT {
                    *value = Value::String(cut(&text));
                }
            }
        }
        for key in ["prompt", "last_assistant_message"] {
            if let Some(Value::String(text)) = map.get_mut(key) {
                if text.chars().count() > MAX_TEXT {
                    *text = cut(text);
                }
            }
        }
    }

    fn cut(text: &str) -> String {
        let mut out: String = text.chars().take(MAX_TEXT).collect();
        out.push_str(" …[cut]");
        out
    }

    /// Assistant text since the last real user prompt in a Claude Code
    /// transcript (JSON lines).
    pub fn last_assistant_text(path: &str) -> String {
        let Ok(content) = std::fs::read_to_string(path) else {
            return String::new();
        };
        let mut texts: Vec<String> = Vec::new();
        for line in content.lines() {
            let Ok(entry) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            let message = entry.get("message").cloned().unwrap_or(Value::Null);
            let role = message
                .get("role")
                .or_else(|| entry.get("type"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let blocks: Vec<Value> = match message.get("content") {
                Some(Value::Array(items)) => items.clone(),
                Some(other) => vec![other.clone()],
                None => Vec::new(),
            };
            if role == "user" {
                let only_tool_results = !blocks.is_empty()
                    && blocks
                        .iter()
                        .all(|b| b.get("type").and_then(Value::as_str) == Some("tool_result"));
                if !only_tool_results {
                    texts.clear();
                }
            } else if role == "assistant" {
                for block in blocks {
                    match block {
                        Value::String(text) => texts.push(text),
                        Value::Object(ref obj)
                            if obj.get("type").and_then(Value::as_str) == Some("text") =>
                        {
                            if let Some(text) = obj.get("text").and_then(Value::as_str) {
                                texts.push(text.to_string());
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
        texts
            .into_iter()
            .filter(|t| !t.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n")
    }

    async fn post(link: &link::Link, client: Option<&str>, body: &str) -> std::io::Result<()> {
        let mut path = String::from("/events");
        if let Some(client) = client {
            path.push_str("?client=");
            path.push_str(client);
        }
        let request = format!(
            "POST {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\n\
             Content-Type: application/json\r\nContent-Length: {len}\r\nConnection: close\r\n\r\n{body}",
            port = link.port,
            token = link.token,
            len = body.len(),
        );
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", link.port)).await?;
        stream.write_all(request.as_bytes()).await?;
        let mut sink = [0u8; 256];
        let _ = stream.read(&mut sink).await;
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn stop_event_gets_the_reply_from_the_transcript() {
            let dir = std::env::temp_dir().join(format!("aura-hook-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join("t.jsonl");
            let lines = [
                r#"{"type":"user","message":{"role":"user","content":"old question"}}"#,
                r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"old answer"}]}}"#,
                r#"{"type":"user","message":{"role":"user","content":"new question"}}"#,
                r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Bash"}]}}"#,
                r#"{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"ok"}]}}"#,
                r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"new answer"}]}}"#,
            ];
            std::fs::write(&path, lines.join("\n")).unwrap();
            let mut event = serde_json::json!({
                "hook_event_name": "Stop",
                "transcript_path": path.to_string_lossy(),
            });
            prepare(&mut event);
            assert_eq!(event["last_assistant_message"], "new answer");
            assert!(event["received_at"].as_f64().unwrap() > 0.0);
            let _ = std::fs::remove_dir_all(dir);
        }

        #[test]
        fn long_tool_output_is_cut() {
            let mut event = serde_json::json!({
                "hook_event_name": "PostToolUse",
                "tool_response": {"stdout": "x".repeat(MAX_TEXT * 2)},
            });
            prepare(&mut event);
            let text = event["tool_response"].as_str().unwrap();
            assert!(text.chars().count() < MAX_TEXT + 20 && text.ends_with("[cut]"));
        }
    }
}
