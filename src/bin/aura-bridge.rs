//! Aura stdio bridge.
//!
//! Clients that can only start a local process (Claude Desktop, some IDEs)
//! run this binary. It reads the running desktop app's link file, starts the
//! app when it is closed, and forwards MCP messages between stdio and the
//! app's loopback HTTP endpoint. One app owns the store; every client shares
//! it.
//!
//! # Usage
//!     aura-bridge [--client NAME]

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
