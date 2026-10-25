//! Aura stdio bridge.
//!
//! Clients that can only start a local process (Claude Desktop, some IDEs)
//! run this binary. It reads the running desktop app's link file, starts the
//! app when it is closed, and forwards MCP messages between stdio and the
//! app's loopback HTTP endpoint. One app owns the store; every client shares
//! it.
//!
//! As `aura-bridge hook --client NAME [--event NAME]` it is an agent hook
//! command for Claude Code, Cursor, Codex, Gemini CLI, Copilot, Windsurf,
//! Qwen Code, Kimi Code and Antigravity: it reads the hook event from stdin,
//! normalizes it to one shape and posts it to the app's journal. It never
//! blocks the agent: exit 0, and the event is dropped when Aura is not
//! running. It prints nothing except what an agent requires (Cursor's
//! `{"continue": true}`, Antigravity's JSON object) and, on a prompt event of
//! an agent that takes context, the memory the app gives with the message
//! (the app decides per agent whether to give any).
//!
//! # Usage
//!     aura-bridge [--client NAME]
//!     aura-bridge hook --client NAME [--event NAME]

use std::time::Duration;

use anyhow::{bail, Context};
use aura::mcp::link;
use rmcp::model::{ClientJsonRpcMessage, ServerJsonRpcMessage};
use rmcp::transport::{
    streamable_http_client::StreamableHttpClientTransportConfig, StreamableHttpClientTransport,
    Transport,
};
use rmcp::RoleClient;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};

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
        let args: Vec<String> = std::env::args().collect();
        let event = args
            .iter()
            .position(|a| a == "--event")
            .and_then(|i| args.get(i + 1))
            .map(String::as_str);
        hook::run(client.as_deref(), event).await;
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
    // The client side is read line by line here rather than through rmcp's
    // stdio transport: a message rmcp cannot type (a newer protocol's
    // `server/discover` probe, sent before `initialize`) would otherwise stall
    // the stream, and the client would time out instead of falling back.
    let mut lines = tokio::io::BufReader::new(tokio::io::stdin()).lines();
    let mut stdout = tokio::io::stdout();

    loop {
        tokio::select! {
            line = lines.next_line() => match line? {
                Some(line) => match parse_client(&line) {
                    Incoming::Message(message) => Transport::<RoleClient>::send(&mut remote, *message).await?,
                    Incoming::Unknown(Some(reply)) => write_line(&mut stdout, &reply).await?,
                    Incoming::Unknown(None) => {}
                },
                None => break,
            },
            message = Transport::<RoleClient>::receive(&mut remote) => match message {
                Some(message) => write_line(&mut stdout, &server_line(&message)?).await?,
                None => bail!("Aura closed the connection"),
            },
        }
    }
    let _ = Transport::<RoleClient>::close(&mut remote).await;
    Ok(())
}

/// One line from the MCP client.
enum Incoming {
    Message(Box<ClientJsonRpcMessage>),
    /// Not a message this protocol knows. A request gets the JSON-RPC reply
    /// to send back ("method not found"); anything else is dropped.
    Unknown(Option<String>),
}

fn parse_client(line: &str) -> Incoming {
    if line.trim().is_empty() {
        return Incoming::Unknown(None);
    }
    if let Ok(message) = serde_json::from_str::<ClientJsonRpcMessage>(line) {
        return Incoming::Message(Box::new(message));
    }
    let value = serde_json::from_str::<serde_json::Value>(line).unwrap_or_default();
    let reply = match (
        value.get("id"),
        value.get("method").and_then(|m| m.as_str()),
    ) {
        (Some(id), Some(method)) => Some(
            serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {"code": -32601, "message": format!("Method not found: {method}")},
            })
            .to_string(),
        ),
        _ => None,
    };
    Incoming::Unknown(reply)
}

fn server_line(message: &ServerJsonRpcMessage) -> anyhow::Result<String> {
    Ok(serde_json::to_string(message)?)
}

async fn write_line(out: &mut tokio::io::Stdout, line: &str) -> std::io::Result<()> {
    out.write_all(line.as_bytes()).await?;
    out.write_all(b"\n").await?;
    out.flush().await
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
    //! Agent hook events for the app's journal, from any agent.
    //!
    //! Claude Code, Cursor, Codex, Gemini CLI, Copilot (VS Code and CLI) and
    //! Windsurf each report the same moments with their own names and fields.
    //! Every event is normalized to one shape (Claude Code's names) before it
    //! is posted, so the app reads a single format:
    //!
    //! `hook_event_name` (`UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
    //! `Stop`, `SessionStart`, `SessionEnd`), `session_id`, `cwd`, `prompt`,
    //! `tool_name`, `tool_input`, `tool_response`, `tool_use_id`, `failed`,
    //! `last_assistant_message`, `transcript_path`, `source_event`, `agent`.
    //!
    //! Nothing is printed except what an agent requires to go on (Cursor's
    //! `beforeSubmitPrompt` needs `{"continue": true}`) and the memory the app
    //! gives with a prompt (`hookSpecificOutput.additionalContext`): any other
    //! output on a prompt event would be added to the model's context.

    use std::time::Duration;

    use aura::mcp::link;
    use serde_json::{json, Map, Value};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// Text fields are cut to this many characters: enough to read, small
    /// enough that a large file read never bloats the journal.
    const MAX_TEXT: usize = 16_000;

    pub async fn run(client: Option<&str>, event_arg: Option<&str>) {
        let mut input = String::new();
        let _ = tokio::io::stdin().read_to_string(&mut input).await;
        let raw = serde_json::from_str::<Value>(&input).unwrap_or(Value::Null);
        let source = source_event(&raw, event_arg);
        let client = agent_of(&raw).or(client);
        // Answer first: the agent may be waiting on this before it goes on.
        if source.as_deref() == Some("beforeSubmitPrompt") {
            println!("{}", json!({"continue": true}));
        }
        let answered = report(raw, source.as_deref(), client).await;
        // Antigravity reads a JSON object from every hook; an empty one
        // changes nothing.
        if !answered && client == Some("antigravity") {
            println!("{{}}");
        }
    }

    /// Posts the event to the journal; true when memory was printed.
    async fn report(mut raw: Value, source: Option<&str>, client: Option<&str>) -> bool {
        if !adapt(&mut raw, source, client) {
            return false;
        }
        let Some(mut event) = normalize(&raw, source) else {
            return false;
        };
        prepare(&mut event);
        let Some(link) = link::read() else {
            return false;
        };
        let mut answered = false;
        // Memory with the message: asked for before the event is posted, since
        // posting keeps the prompt itself as a memory.
        if let (Some(how), Some(prompt)) = (
            inject_event(source, client),
            event.get("prompt").and_then(Value::as_str),
        ) {
            let request = json!({"prompt": prompt, "session_id": event.get("session_id"), "cwd": event.get("cwd")});
            if let Ok(Some(context)) = tokio::time::timeout(
                Duration::from_secs(3),
                fetch_context(&link, client, &request.to_string()),
            )
            .await
            {
                println!("{}", inject_output(how, &context));
                answered = true;
            }
        }
        let body = event.to_string();
        let _ = tokio::time::timeout(Duration::from_secs(2), post(&link, client, &body)).await;
        answered
    }

    /// Fills in the user's message where an agent's payload does not carry
    /// it plainly; false when the event is not a new user message after all.
    ///
    /// Antigravity's `PreInvocation` runs before every model call and carries
    /// no text: the request comes from its transcript, once per turn. Qwen
    /// Code runs `UserPromptSubmit` before continuations too; only
    /// `submitted_prompt` is what the user sent.
    pub fn adapt(raw: &mut Value, source: Option<&str>, client: Option<&str>) -> bool {
        let prompt = match (source, client) {
            (Some("PreInvocation"), _) => raw
                .get("transcriptPath")
                .and_then(Value::as_str)
                .and_then(antigravity_new_request),
            (Some("UserPromptSubmit"), Some("qwen-code")) => raw
                .get("submitted_prompt")
                .and_then(Value::as_str)
                .map(str::to_owned),
            _ => return true,
        };
        match (prompt, raw.as_object_mut()) {
            (Some(prompt), Some(map)) => {
                map.insert("prompt".into(), prompt.into());
                true
            }
            _ => false,
        }
    }

    /// How an agent takes memory from a prompt hook.
    #[derive(Debug, Clone, Copy, PartialEq)]
    pub enum Inject {
        /// `hookSpecificOutput.additionalContext` under this event name:
        /// Claude Code, Codex, Qwen Code (`UserPromptSubmit`), Gemini CLI
        /// (`BeforeAgent`).
        Hook(&'static str),
        /// Plain text on stdout (Kimi Code, which ignores the JSON form).
        Plain,
        /// A system step (Antigravity's `PreInvocation`).
        Steps,
    }

    /// Whether this prompt event may add memory for the model, and how.
    /// Cursor, Copilot and Windsurf cannot add context from a prompt hook;
    /// Cursor also runs Claude Code's hooks, so its copy is left out by client.
    pub fn inject_event(source: Option<&str>, client: Option<&str>) -> Option<Inject> {
        if client == Some("cursor") {
            return None;
        }
        match source? {
            "UserPromptSubmit" if client == Some("kimi-code") => Some(Inject::Plain),
            "UserPromptSubmit" => Some(Inject::Hook("UserPromptSubmit")),
            "BeforeAgent" => Some(Inject::Hook("BeforeAgent")),
            "PreInvocation" => Some(Inject::Steps),
            _ => None,
        }
    }

    /// The hook's answer that hands `context` to the model.
    pub fn inject_output(how: Inject, context: &str) -> String {
        match how {
            Inject::Hook(event_name) => json!({"hookSpecificOutput": {
                "hookEventName": event_name, "additionalContext": context
            }})
            .to_string(),
            Inject::Plain => context.to_owned(),
            Inject::Steps => {
                json!({"injectSteps": [{"systemMessage": {"systemMessage": context}}]}).to_string()
            }
        }
    }

    /// The request of the turn that is starting in an Antigravity transcript
    /// (JSON lines): the last user input, while no model step follows it yet,
    /// so memory goes with the turn's first model call only.
    pub fn antigravity_new_request(path: &str) -> Option<String> {
        let content = std::fs::read_to_string(path).ok()?;
        let mut request = None;
        for line in content.lines() {
            let Ok(entry) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            match (entry["source"].as_str(), entry["type"].as_str()) {
                (_, Some("USER_INPUT")) => {
                    request = entry["content"].as_str().map(antigravity_request)
                }
                (Some("MODEL"), _) => request = None,
                _ => {}
            }
        }
        request.filter(|r| !r.trim().is_empty())
    }

    /// The user's words inside Antigravity's `<USER_REQUEST>` wrapper.
    fn antigravity_request(content: &str) -> String {
        content
            .split_once("<USER_REQUEST>")
            .and_then(|(_, rest)| rest.split_once("</USER_REQUEST>"))
            .map_or(content, |(request, _)| request)
            .trim()
            .to_owned()
    }

    /// The app's memory for this message (`/context`), if it gives any.
    async fn fetch_context(link: &link::Link, client: Option<&str>, body: &str) -> Option<String> {
        let mut path = String::from("/context");
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
        let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", link.port))
            .await
            .ok()?;
        stream.write_all(request.as_bytes()).await.ok()?;
        let mut response = Vec::new();
        stream.read_to_end(&mut response).await.ok()?;
        let response = String::from_utf8_lossy(&response);
        let (head, payload) = response.split_once("\r\n\r\n")?;
        if !head.starts_with("HTTP/1.1 200") {
            return None;
        }
        let value: Value = serde_json::from_str(payload.trim()).ok()?;
        value
            .get("context")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .filter(|c| !c.trim().is_empty())
    }

    /// The agent's own name for this event: the payload's, else `--event`.
    fn source_event(raw: &Value, event_arg: Option<&str>) -> Option<String> {
        ["hook_event_name", "agent_action_name", "hookEventName"]
            .iter()
            .find_map(|k| raw.get(*k).and_then(Value::as_str))
            .or(event_arg)
            .map(str::to_owned)
    }

    /// Cursor also runs hooks written for Claude Code; its payload says so.
    fn agent_of(raw: &Value) -> Option<&'static str> {
        raw.get("cursor_version").map(|_| "cursor")
    }

    /// The shared name of an agent's event, and whether it reports a failure.
    fn canonical(source: &str) -> Option<(&'static str, bool)> {
        Some(match source {
            "UserPromptSubmit"
            | "userPromptSubmitted"
            | "beforeSubmitPrompt"
            | "BeforeAgent"
            | "PreInvocation"
            | "pre_user_prompt" => ("UserPromptSubmit", false),
            "PreToolUse" | "preToolUse" | "BeforeTool" => ("PreToolUse", false),
            "PostToolUse"
            | "postToolUse"
            | "AfterTool"
            | "afterShellExecution"
            | "afterMCPExecution"
            | "afterFileEdit"
            | "post_run_command"
            | "post_mcp_tool_use"
            | "post_write_code" => ("PostToolUse", false),
            "PostToolUseFailure" | "postToolUseFailure" => ("PostToolUse", true),
            "Stop"
            | "agentStop"
            | "AfterAgent"
            | "afterAgentResponse"
            | "post_cascade_response"
            | "post_cascade_response_with_transcript" => ("Stop", false),
            "SessionStart" | "sessionStart" => ("SessionStart", false),
            "SessionEnd" | "sessionEnd" => ("SessionEnd", false),
            _ => return None,
        })
    }

    fn first<'a>(raw: &'a Value, paths: &[&str]) -> Option<&'a Value> {
        paths.iter().find_map(|path| {
            let mut value = raw;
            for key in path.split('.') {
                value = match key.parse::<usize>() {
                    Ok(index) => value.get(index)?,
                    Err(_) => value.get(key)?,
                };
            }
            (!value.is_null()).then_some(value)
        })
    }

    fn text(raw: &Value, paths: &[&str]) -> Option<String> {
        first(raw, paths).and_then(Value::as_str).map(str::to_owned)
    }

    /// One shape for every agent; `None` for events the journal does not use.
    pub fn normalize(raw: &Value, source: Option<&str>) -> Option<Value> {
        let source = source?;
        let (name, failed) = canonical(source)?;
        let mut out = Map::new();
        out.insert("hook_event_name".into(), name.into());
        out.insert("source_event".into(), source.into());
        let mut put = |key: &str, value: Option<Value>| {
            if let Some(value) = value {
                out.insert(key.into(), value);
            }
        };
        put(
            "session_id",
            first(
                raw,
                &[
                    "session_id",
                    "sessionId",
                    "conversation_id",
                    "trajectory_id",
                    "conversationId",
                ],
            )
            .cloned(),
        );
        put(
            "cwd",
            first(
                raw,
                &[
                    "cwd",
                    "workspace_roots.0",
                    "tool_info.cwd",
                    "workspacePaths.0",
                ],
            )
            .cloned(),
        );
        put(
            "transcript_path",
            first(
                raw,
                &[
                    "transcript_path",
                    "transcriptPath",
                    "tool_info.transcript_path",
                ],
            )
            .cloned(),
        );
        match name {
            "UserPromptSubmit" => {
                // Kimi Code may send the message as a list of parts.
                let prompt = match first(raw, &["prompt", "tool_info.user_prompt"]) {
                    Some(Value::Array(parts)) => Some(
                        parts
                            .iter()
                            .filter_map(|p| p.as_str().or_else(|| p.get("text")?.as_str()))
                            .collect::<Vec<_>>()
                            .join("\n"),
                    ),
                    Some(value) => value.as_str().map(str::to_owned),
                    None => None,
                };
                put("prompt", prompt.map(Value::from));
            }
            "PreToolUse" | "PostToolUse" => {
                let tool = text(
                    raw,
                    &[
                        "tool_name",
                        "toolName",
                        "tool_info.mcp_tool_name",
                        "toolCall.name",
                    ],
                )
                .or_else(|| match source {
                    "afterShellExecution" | "post_run_command" => Some("Shell".into()),
                    "post_write_code" | "afterFileEdit" => Some("Edit".into()),
                    _ => None,
                });
                put("tool_name", tool.map(Value::from));
                let input = first(
                    raw,
                    &[
                        "tool_input",
                        "toolArgs",
                        "tool_info.mcp_tool_arguments",
                        "toolCall.args",
                    ],
                )
                .cloned()
                .or_else(|| {
                    text(raw, &["command", "tool_info.command_line"])
                        .map(|c| json!({ "command": c }))
                })
                .or_else(|| {
                    text(raw, &["file_path", "tool_info.file_path"])
                        .map(|f| json!({ "file_path": f }))
                });
                put("tool_input", input);
                put(
                    "tool_response",
                    first(
                        raw,
                        &[
                            "tool_response",
                            "tool_output",
                            "tool_result",
                            "toolResult",
                            "result_json",
                            "output",
                            "tool_info.mcp_result",
                        ],
                    )
                    .cloned(),
                );
                put(
                    "tool_use_id",
                    first(raw, &["tool_use_id", "toolUseId", "tool_call_id"]).cloned(),
                );
                let result_type = text(raw, &["toolResult.resultType", "tool_result.result_type"]);
                // Antigravity reports a failed tool only by its `error`.
                let error = first(raw, &["error"]).is_some_and(|e| e.as_str() != Some(""));
                if failed || error || result_type.is_some_and(|t| t != "success") {
                    put("failed", Some(Value::Bool(true)));
                }
            }
            "Stop" => {
                put(
                    "last_assistant_message",
                    text(
                        raw,
                        &[
                            "last_assistant_message",
                            "text",
                            "prompt_response",
                            "tool_info.response",
                        ],
                    )
                    .map(Value::from),
                );
            }
            _ => {
                put("source", first(raw, &["source", "reason"]).cloned());
            }
        }
        Some(Value::Object(out))
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
            // Antigravity's transcript: one step per line.
            match entry.get("type").and_then(Value::as_str) {
                Some("USER_INPUT") => {
                    texts.clear();
                    continue;
                }
                Some("PLANNER_RESPONSE") => {
                    if let Some(text) = entry.get("content").and_then(Value::as_str) {
                        texts.push(text.to_string());
                    }
                    continue;
                }
                _ => {}
            }
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

        fn n(raw: Value, arg: Option<&str>) -> Value {
            let source = source_event(&raw, arg);
            normalize(&raw, source.as_deref()).expect("a journal event")
        }

        #[test]
        fn cursor_prompt_and_reply() {
            let p = n(
                json!({"hook_event_name": "beforeSubmitPrompt", "conversation_id": "c1",
                             "workspace_roots": ["D:/proj"], "prompt": "hi", "cursor_version": "1.9"}),
                None,
            );
            assert_eq!(p["hook_event_name"], "UserPromptSubmit");
            assert_eq!(
                (
                    p["session_id"].as_str(),
                    p["cwd"].as_str(),
                    p["prompt"].as_str()
                ),
                (Some("c1"), Some("D:/proj"), Some("hi"))
            );
            assert_eq!(agent_of(&json!({"cursor_version": "1.9"})), Some("cursor"));
            let r = n(
                json!({"hook_event_name": "afterAgentResponse", "conversation_id": "c1", "text": "done"}),
                None,
            );
            assert_eq!(
                (
                    r["hook_event_name"].as_str(),
                    r["last_assistant_message"].as_str()
                ),
                (Some("Stop"), Some("done"))
            );
            let t = n(
                json!({"hook_event_name": "afterShellExecution", "conversation_id": "c1", "command": "cargo test", "output": "ok"}),
                None,
            );
            assert_eq!(
                (
                    t["tool_name"].as_str(),
                    t["tool_input"]["command"].as_str(),
                    t["tool_response"].as_str()
                ),
                (Some("Shell"), Some("cargo test"), Some("ok"))
            );
        }

        #[test]
        fn gemini_codex_copilot_windsurf() {
            let g = n(
                json!({"hook_event_name": "AfterAgent", "session_id": "g", "prompt": "q", "prompt_response": "a"}),
                None,
            );
            assert_eq!(
                (
                    g["hook_event_name"].as_str(),
                    g["last_assistant_message"].as_str()
                ),
                (Some("Stop"), Some("a"))
            );
            assert!(g.get("prompt").is_none(), "a reply event carries no prompt");
            let c = n(
                json!({"hook_event_name": "PostToolUse", "session_id": "x", "tool_name": "Bash", "tool_input": {"command": "ls"}, "tool_response": {"stdout": "a"}}),
                None,
            );
            assert_eq!(
                (
                    c["tool_name"].as_str(),
                    c["tool_response"]["stdout"].as_str()
                ),
                (Some("Bash"), Some("a"))
            );
            // Copilot CLI camelCase payloads carry no event name: it comes from --event.
            let cp = n(
                json!({"sessionId": "s", "toolName": "bash", "toolArgs": "{}", "toolResult": {"resultType": "failure", "textResultForLlm": "boom"}}),
                Some("postToolUse"),
            );
            assert_eq!(
                (
                    cp["hook_event_name"].as_str(),
                    cp["session_id"].as_str(),
                    cp["failed"].as_bool()
                ),
                (Some("PostToolUse"), Some("s"), Some(true))
            );
            let w = n(
                json!({"agent_action_name": "pre_user_prompt", "trajectory_id": "t", "tool_info": {"user_prompt": "hello"}}),
                None,
            );
            assert_eq!(
                (w["session_id"].as_str(), w["prompt"].as_str()),
                (Some("t"), Some("hello"))
            );
            let wm = n(
                json!({"agent_action_name": "post_mcp_tool_use", "trajectory_id": "t", "tool_info": {"mcp_tool_name": "recall", "mcp_tool_arguments": {"query": "x"}, "mcp_result": "r"}}),
                None,
            );
            assert_eq!(
                (wm["tool_name"].as_str(), wm["tool_response"].as_str()),
                (Some("recall"), Some("r"))
            );
            let f = n(
                json!({"hook_event_name": "postToolUseFailure", "tool_name": "Shell"}),
                None,
            );
            assert_eq!(f["failed"], true);
        }

        #[test]
        fn memory_goes_with_prompts_of_agents_that_take_context() {
            let hook = Some(Inject::Hook("UserPromptSubmit"));
            assert_eq!(
                inject_event(Some("UserPromptSubmit"), Some("claude-code")),
                hook
            );
            assert_eq!(inject_event(Some("UserPromptSubmit"), Some("codex")), hook);
            assert_eq!(
                inject_event(Some("UserPromptSubmit"), Some("qwen-code")),
                hook
            );
            assert_eq!(
                inject_event(Some("BeforeAgent"), Some("gemini-cli")),
                Some(Inject::Hook("BeforeAgent"))
            );
            assert_eq!(
                inject_event(Some("UserPromptSubmit"), Some("kimi-code")),
                Some(Inject::Plain)
            );
            assert_eq!(
                inject_event(Some("PreInvocation"), Some("antigravity")),
                Some(Inject::Steps)
            );
            // Cursor runs Claude Code's hooks too, but cannot take context from them.
            assert_eq!(inject_event(Some("UserPromptSubmit"), Some("cursor")), None);
            assert_eq!(
                inject_event(Some("beforeSubmitPrompt"), Some("cursor")),
                None
            );
            assert_eq!(inject_event(Some("PreToolUse"), Some("claude-code")), None);
            let out: Value =
                serde_json::from_str(&inject_output(Inject::Hook("BeforeAgent"), "port 7311"))
                    .unwrap();
            assert_eq!(out["hookSpecificOutput"]["hookEventName"], "BeforeAgent");
            assert_eq!(out["hookSpecificOutput"]["additionalContext"], "port 7311");
            assert_eq!(inject_output(Inject::Plain, "port 7311"), "port 7311");
            let out: Value =
                serde_json::from_str(&inject_output(Inject::Steps, "port 7311")).unwrap();
            assert_eq!(
                out["injectSteps"][0]["systemMessage"]["systemMessage"],
                "port 7311"
            );
        }

        #[test]
        fn antigravity_takes_the_request_from_its_transcript_once_per_turn() {
            let dir = std::env::temp_dir().join(format!("aura-ag-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let path = dir.join("transcript.jsonl");
            let user = |text: &str| {
                json!({"source": "USER_EXPLICIT", "type": "USER_INPUT", "content":
                    format!("<USER_REQUEST>\n{text}\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nnow\n</ADDITIONAL_METADATA>")})
                .to_string()
            };
            let model = |text: &str| {
                json!({"source": "MODEL", "type": "PLANNER_RESPONSE", "content": text}).to_string()
            };
            let tool = json!({"source": "MODEL", "type": "VIEW_FILE"}).to_string();
            let mut lines = vec![
                user("old question"),
                model("old answer"),
                user("new question"),
            ];
            std::fs::write(&path, lines.join("\n")).unwrap();
            let payload = json!({"conversationId": "c", "workspacePaths": ["D:/proj"],
                "transcriptPath": path.to_string_lossy(), "invocationNum": 1});

            let mut raw = payload.clone();
            assert!(adapt(&mut raw, Some("PreInvocation"), Some("antigravity")));
            let p = normalize(&raw, Some("PreInvocation")).unwrap();
            assert_eq!(
                (
                    p["hook_event_name"].as_str(),
                    p["prompt"].as_str(),
                    p["session_id"].as_str(),
                    p["cwd"].as_str()
                ),
                (
                    Some("UserPromptSubmit"),
                    Some("new question"),
                    Some("c"),
                    Some("D:/proj")
                )
            );
            // Later model calls of the same turn are not new messages.
            lines.extend([model("thinking"), tool]);
            std::fs::write(&path, lines.join("\n")).unwrap();
            let mut raw = payload.clone();
            assert!(!adapt(&mut raw, Some("PreInvocation"), Some("antigravity")));

            let t = n(
                json!({"toolCall": {"name": "run_command", "args": {"CommandLine": "npm test"}},
                    "error": "exit status 1", "conversationId": "c"}),
                Some("PostToolUse"),
            );
            assert_eq!(
                (
                    t["tool_name"].as_str(),
                    t["tool_input"]["CommandLine"].as_str(),
                    t["failed"].as_bool()
                ),
                (Some("run_command"), Some("npm test"), Some(true))
            );
            let mut stop = json!({"hook_event_name": "Stop",
                "transcript_path": path.to_string_lossy()});
            lines.push(model("new answer"));
            std::fs::write(&path, lines.join("\n")).unwrap();
            prepare(&mut stop);
            assert_eq!(stop["last_assistant_message"], "thinking\nnew answer");
            let _ = std::fs::remove_dir_all(dir);
        }

        #[test]
        fn qwen_and_kimi_prompts() {
            // Qwen Code: only what the user submitted is a message.
            let mut raw = json!({"hook_event_name": "UserPromptSubmit", "session_id": "q",
                "prompt": "tool result text", "submitted_prompt": "fix the build"});
            assert!(adapt(&mut raw, Some("UserPromptSubmit"), Some("qwen-code")));
            assert_eq!(n(raw, None)["prompt"].as_str(), Some("fix the build"));
            let mut cont =
                json!({"hook_event_name": "UserPromptSubmit", "prompt": "tool result text"});
            assert!(!adapt(
                &mut cont,
                Some("UserPromptSubmit"),
                Some("qwen-code")
            ));
            // Other agents' prompts pass as they are.
            let mut claude = json!({"hook_event_name": "UserPromptSubmit", "prompt": "hi"});
            assert!(adapt(
                &mut claude,
                Some("UserPromptSubmit"),
                Some("claude-code")
            ));

            let k = n(
                json!({"hook_event_name": "UserPromptSubmit", "session_id": "k",
                    "prompt": [{"type": "text", "text": "first"}, {"type": "text", "text": "second"}]}),
                None,
            );
            assert_eq!(k["prompt"].as_str(), Some("first\nsecond"));
            let kt = n(
                json!({"hook_event_name": "PostToolUse", "tool_name": "Bash", "tool_call_id": "t1",
                    "tool_input": {"command": "ls"}, "tool_output": "a"}),
                None,
            );
            assert_eq!(
                (
                    kt["tool_use_id"].as_str(),
                    kt["tool_response"].as_str(),
                    kt.get("failed")
                ),
                (Some("t1"), Some("a"), None)
            );
        }

        #[test]
        fn unknown_or_missing_events_are_dropped() {
            assert!(normalize(
                &json!({"hook_event_name": "PreCompact"}),
                Some("PreCompact")
            )
            .is_none());
            assert!(normalize(&json!({}), None).is_none());
        }

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_newer_protocol_probe_gets_method_not_found() {
        let Incoming::Unknown(Some(reply)) =
            parse_client(r#"{"jsonrpc":"2.0","id":0,"method":"server/discover","params":{}}"#)
        else {
            panic!("a request rmcp cannot type must be answered");
        };
        let reply: serde_json::Value = serde_json::from_str(&reply).unwrap();
        assert_eq!(reply["id"], 0);
        assert_eq!(reply["error"]["code"], -32601);
    }

    #[test]
    fn known_messages_pass_and_noise_is_dropped() {
        let init = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"c","version":"1"}}}"#;
        assert!(matches!(parse_client(init), Incoming::Message(_)));
        assert!(matches!(parse_client(""), Incoming::Unknown(None)));
        assert!(matches!(parse_client("not json"), Incoming::Unknown(None)));
        assert!(matches!(
            parse_client(r#"{"jsonrpc":"2.0","method":"notifications/unknown"}"#),
            Incoming::Unknown(None)
        ));
    }
}
