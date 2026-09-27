use std::sync::atomic::Ordering;
use std::time::Instant;

use axum::{
    extract::{Request, State},
    http::{header, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use metrics::{counter, histogram};

use super::state::{ServerState, API_PATHS};

pub(super) async fn auth_middleware(
    State(state): State<ServerState>,
    req: Request,
    next: Next,
) -> Response {
    let expected = match state.api_key.as_deref() {
        Some(k) => k,
        // Without a key the server is only safe when reached as localhost;
        // rejecting other Host values blocks DNS-rebinding attacks.
        None if is_loopback_host(&req) => return next.run(req).await,
        None => return StatusCode::FORBIDDEN.into_response(),
    };

    let path = req.uri().path().to_string();
    let is_api = API_PATHS.iter().any(|p| path.starts_with(p));
    if !is_api {
        return next.run(req).await;
    }

    let auth_header = req
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    match auth_header {
        Some(value) if value.starts_with("Bearer ") => {
            let token = &value[7..];
            if constant_time_eq(token.as_bytes(), expected.as_bytes()) {
                next.run(req).await
            } else {
                StatusCode::UNAUTHORIZED.into_response()
            }
        }
        _ => StatusCode::UNAUTHORIZED.into_response(),
    }
}

fn is_loopback_host(req: &Request) -> bool {
    let Some(host) = req
        .headers()
        .get(header::HOST)
        .and_then(|value| value.to_str().ok())
    else {
        return false;
    };
    let name = if let Some(rest) = host.strip_prefix('[') {
        rest.split(']').next().unwrap_or_default()
    } else {
        host.rsplit_once(':').map_or(host, |(name, _port)| name)
    };
    name.eq_ignore_ascii_case("localhost")
        || name
            .parse::<std::net::IpAddr>()
            .map(|ip| ip.is_loopback())
            .unwrap_or(false)
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0u8, |acc, (a, b)| acc | (a ^ b))
        == 0
}

pub(super) async fn rate_limit_middleware(
    State(state): State<ServerState>,
    req: Request,
    next: Next,
) -> Response {
    let max = state.rate_limit.max.load(Ordering::Relaxed);
    if max == 0 {
        return next.run(req).await;
    }

    let should_allow = {
        let mut window = state.rate_limit.window_start.lock().unwrap();
        let now = Instant::now();
        if now.duration_since(*window).as_secs() >= 1 {
            *window = now;
            state.rate_limit.counter.store(1, Ordering::Relaxed);
            true
        } else {
            let count = state.rate_limit.counter.fetch_add(1, Ordering::Relaxed);
            count < max
        }
    };

    if should_allow {
        next.run(req).await
    } else {
        StatusCode::TOO_MANY_REQUESTS.into_response()
    }
}

pub(super) async fn metrics_middleware(req: Request, next: Next) -> Response {
    let path = req.uri().path().to_string();
    let method = req.method().to_string();
    let start = Instant::now();

    let response = next.run(req).await;

    let duration = start.elapsed().as_secs_f64();
    let status = response.status().as_u16().to_string();

    counter!("aura_http_requests_total", "method" => method.clone(), "path" => path.clone(), "status" => status).increment(1);
    histogram!("aura_http_request_duration_seconds", "method" => method, "path" => path)
        .record(duration);

    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;

    fn request_with_host(host: &str) -> Request {
        Request::builder()
            .uri("/")
            .header(header::HOST, host)
            .body(Body::empty())
            .unwrap()
    }

    #[test]
    fn loopback_hosts_are_accepted_and_rebinding_hosts_rejected() {
        for host in [
            "localhost",
            "localhost:8000",
            "127.0.0.1:8000",
            "[::1]:8000",
        ] {
            assert!(is_loopback_host(&request_with_host(host)), "{host}");
        }
        for host in ["evil.example", "evil.example:8000", "192.168.1.5:8000"] {
            assert!(!is_loopback_host(&request_with_host(host)), "{host}");
        }
    }

    #[test]
    fn constant_time_eq_matches_only_identical_tokens() {
        assert!(constant_time_eq(b"secret", b"secret"));
        assert!(!constant_time_eq(b"secret", b"secreT"));
        assert!(!constant_time_eq(b"secret", b"secret2"));
    }
}
