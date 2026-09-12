//! Non-destructive lifetime audit. Every probe uses a temporary store.
//! Run: cargo run --offline --no-default-features --example lifetime_audit
//! Observations characterize current behavior; they are not acceptance tests.
use anyhow::Result;
use aura::background_brain::{
    archive_old_records, guarded_reflect, ArchivalRule, MaintenanceConfig,
};
use aura::trust::TagTaxonomy;
use aura::{Aura, Level, Record};
use serde_json::{json, Value};
use std::collections::HashMap;

fn put(a: &Aura, text: &str) -> Result<Record> {
    a.store(
        text,
        Some(Level::Working),
        None,
        None,
        None,
        None,
        None,
        Some(false),
        None,
        Some("audit"),
        None,
    )
}

fn config(decay: bool, archival: bool) -> MaintenanceConfig {
    MaintenanceConfig {
        decay_enabled: decay,
        archival_enabled: archival,
        reflect_enabled: false,
        insights_enabled: false,
        consolidation_enabled: false,
        synthesis_enabled: false,
        ..MaintenanceConfig::default()
    }
}

fn query(a: &Aura, text: &str, id: &str, min: f32) -> Result<bool> {
    Ok(a.recall_as_of(
        text,
        1_800_000_000.0,
        Some(5),
        Some(min),
        Some(false),
        Some(&["audit"]),
    )?
    .iter()
    .any(|(_, r)| r.id == id))
}

fn main() -> Result<()> {
    let mut out = serde_json::Map::new();
    let mut ticks = Vec::new();
    for (name, tag) in [
        ("candidate", None),
        ("evidence_debt", Some("consequence-inconclusive")),
        ("confirmed", Some("consequence-support")),
    ] {
        let mut r = Record::new("Stable operational evidence".into(), Level::Working);
        if let Some(t) = tag {
            r.tags.push(t.into());
        }
        let mut n = 0;
        let mut excluded = None;
        while r.is_alive() && n < 1000 {
            r.apply_route_state_decay();
            n += 1;
            if r.strength < 0.1 && excluded.is_none() {
                excluded = Some(n);
            }
        }
        ticks.push(
            json!({"class":name,"default_recall_excluded_at_tick":excluded,
            "below_alive_at_tick":n,"strength":r.strength}),
        );
    }
    out.insert("route_ticks".into(), json!(ticks));
    let mut fresh = Record::new("Evidence".into(), Level::Working);
    let mut old = fresh.clone();
    old.created_at -= 365.0 * 86400.0;
    old.last_activated = old.created_at;
    fresh.apply_route_state_decay();
    old.apply_route_state_decay();
    out.insert(
        "age_invariance".into(),
        json!({"fresh":fresh.strength,"year_old":old.strength}),
    );

    let mut untouched = Record::new("Never confirmed candidate".into(), Level::Working);
    let mut repeatedly_retrieved = untouched.clone();
    for _ in 0..1000 {
        untouched.apply_route_state_decay();
        repeatedly_retrieved.activate();
        repeatedly_retrieved.apply_route_state_decay();
    }
    out.insert(
        "retrieval_feedback_loop".into(),
        json!({"ticks":1000,
        "untouched_strength":untouched.strength,
        "retrieved_each_tick_strength":repeatedly_retrieved.strength,
        "retrieved_class":format!("{:?}",repeatedly_retrieved.route_state_class())}),
    );

    {
        let now = chrono::Utc::now();
        let timestamp = (now - chrono::Duration::days(1) + chrono::Duration::minutes(1))
            .with_timezone(&chrono::FixedOffset::west_opt(12 * 3600).unwrap())
            .to_rfc3339();
        let mut r = Record::new("Cache still inside age allowance".into(), Level::Working);
        r.tags = vec!["web-search-cache".into()];
        r.metadata.insert("timestamp".into(), timestamp.clone());
        let id = r.id.clone();
        let mut records = HashMap::from([(id.clone(), r)]);
        archive_old_records(
            &mut records,
            &MaintenanceConfig::default(),
            &TagTaxonomy::default(),
        );
        out.insert(
            "timestamp_offset_comparison".into(),
            json!({"timestamp":timestamp,
            "true_age_seconds":86340,"limit_seconds":86400,"survives":records.contains_key(&id)}),
        );
    }

    for (label, maintenance) in [
        ("standalone_decay_restart", false),
        ("maintenance_decay_restart", true),
    ] {
        let dir = tempfile::tempdir()?;
        let a = Aura::open(dir.path().to_str().unwrap())?;
        a.configure_maintenance(config(true, false));
        let r = put(&a, "Durable deployment evidence cedar")?;
        if maintenance {
            a.run_maintenance();
        } else {
            a.decay()?;
        }
        let live = a.get(&r.id).unwrap().strength;
        a.close()?;
        drop(a);
        let b = Aura::open(dir.path().to_str().unwrap())?;
        out.insert(
            label.into(),
            json!({"before":r.strength,"after_tick":live,
            "after_reopen":b.get(&r.id).map(|v|v.strength)}),
        );
        b.close()?;
    }

    {
        let dir = tempfile::tempdir()?;
        let a = Aura::open(dir.path().to_str().unwrap())?;
        a.configure_maintenance(config(true, false));
        let r = put(&a, "Historical gateway approval evidence birch")?;
        a.set_temporal_validity(&r.id, Some(100.0), Some(200.0))?;
        let before = a
            .recall_as_of(
                "Historical gateway approval evidence birch",
                150.0,
                Some(5),
                Some(0.0),
                Some(false),
                Some(&["audit"]),
            )?
            .len();
        let timer = std::time::Instant::now();
        for _ in 0..14 {
            a.run_maintenance();
        }
        let elapsed = timer.elapsed().as_secs_f64();
        let after = a
            .recall_as_of(
                "Historical gateway approval evidence birch",
                150.0,
                Some(5),
                Some(0.0),
                Some(false),
                Some(&["audit"]),
            )?
            .len();
        a.close()?;
        drop(a);
        let b = Aura::open(dir.path().to_str().unwrap())?;
        out.insert(
            "maintenance_deletes_historical_evidence".into(),
            json!({"ticks":14,
            "elapsed_seconds":elapsed,"historical_hits_before":before,"historical_hits_after":after,
            "exists_after_reopen":b.get(&r.id).is_some()}),
        );
        b.close()?;
    }

    {
        let dir = tempfile::tempdir()?;
        let a = Aura::open(dir.path().to_str().unwrap())?;
        let text = "Cold tier searchable evidence alder";
        let r = put(&a, text)?;
        for _ in 0..14 {
            a.decay_by_route_state()?;
        }
        let live = a.get(&r.id).is_some();
        let recall = query(&a, text, &r.id, 0.0)?;
        a.close()?;
        drop(a);
        let b = Aura::open(dir.path().to_str().unwrap())?;
        out.insert(
            "cold_demotion".into(),
            json!({"active_before_restart":live,
            "recall_before_restart_min_zero":recall,"active_after_restart":b.get(&r.id).is_some(),
            "recall_after_restart_min_zero":query(&b,text,&r.id,0.0)?,
            "recall_after_restart_default_min":query(&b,text,&r.id,0.1)?}),
        );
        b.close()?;
    }

    {
        let dir = tempfile::tempdir()?;
        let a = Aura::open(dir.path().to_str().unwrap())?;
        let r = put(&a, "Cold trace should survive unrelated compaction maple")?;
        for _ in 0..14 {
            a.decay_by_route_state()?;
        }
        for i in 0..101 {
            let v = put(&a, &format!("Disposable unrelated document item {i}"))?;
            a.update(&v.id, None, None, None, Some(0.051), None, None)?;
        }
        let (_, deleted) = a.decay()?;
        a.close()?;
        drop(a);
        let b = Aura::open(dir.path().to_str().unwrap())?;
        out.insert(
            "cold_trace_after_compaction".into(),
            json!({"unrelated_deleted":deleted,
            "cold_record_exists_after_reopen":b.get(&r.id).is_some()}),
        );
        b.close()?;
    }

    {
        let dir = tempfile::tempdir()?;
        let a = Aura::open(dir.path().to_str().unwrap())?;
        a.configure_maintenance(config(false, true));
        let r = put(&a, "New web cache response without metadata timestamp oak")?;
        a.update(
            &r.id,
            None,
            None,
            Some(vec!["web-search-cache".into()]),
            None,
            Some(HashMap::new()),
            None,
        )?;
        let report = a.run_maintenance();
        let live = a.get(&r.id).is_some();
        a.close()?;
        drop(a);
        let b = Aura::open(dir.path().to_str().unwrap())?;
        out.insert(
            "fresh_missing_timestamp_archival".into(),
            json!({"archived":report.records_archived,
            "active_after_maintenance":live,"active_after_reopen":b.get(&r.id).is_some()}),
        );
        b.close()?;
    }

    {
        let mut cfg = config(false, true);
        cfg.archival_rules = vec![ArchivalRule {
            tag: "session-summary".into(),
            max_age_days: 14,
            keep_recent: 1,
        }];
        cfg.completed_archival_rules.clear();
        let mut a = Record::new("Tenant A unique old evidence".into(), Level::Working);
        a.namespace = "A".into();
        a.tags = vec!["session-summary".into()];
        a.metadata
            .insert("timestamp".into(), "2020-01-01T00:00:00Z".into());
        let mut b = a.clone();
        b.id = "tenant-b".into();
        b.namespace = "B".into();
        b.metadata
            .insert("timestamp".into(), "2021-01-01T00:00:00Z".into());
        let mut alone = HashMap::from([(a.id.clone(), a.clone())]);
        let mut neighbors = HashMap::from([(a.id.clone(), a.clone()), (b.id.clone(), b)]);
        archive_old_records(&mut alone, &cfg, &TagTaxonomy::default());
        archive_old_records(&mut neighbors, &cfg, &TagTaxonomy::default());
        out.insert(
            "tenant_retention_interference".into(),
            json!({"A_survives_alone":alone.contains_key(&a.id),
            "A_survives_with_B":neighbors.contains_key(&a.id)}),
        );
    }

    {
        let mut protected = Record::new("Protected completed item".into(), Level::Identity);
        protected.tags = vec!["identity".into(), "todo-item".into()];
        protected.metadata.insert("status".into(), "done".into());
        protected
            .metadata
            .insert("completed_at".into(), "2020-01-01T00:00:00Z".into());
        let id = protected.id.clone();
        let mut records = HashMap::from([(id.clone(), protected)]);
        archive_old_records(
            &mut records,
            &MaintenanceConfig::default(),
            &TagTaxonomy::default(),
        );
        out.insert(
            "completion_ignores_identity_guard".into(),
            json!({"survives":records.contains_key(&id)}),
        );
    }

    {
        let dir = tempfile::tempdir()?;
        let a = Aura::open(dir.path().to_str().unwrap())?;
        let r = put(&a, "Refuted operational consequence scar willow")?;
        a.update(
            &r.id,
            None,
            None,
            Some(vec!["consequence-refute".into()]),
            Some(0.04),
            None,
            None,
        )?;
        a.reflect()?;
        a.close()?;
        drop(a);
        let b = Aura::open(dir.path().to_str().unwrap())?;
        let mut scar = Record::new("weak scar".into(), Level::Working);
        scar.tags = vec!["consequence-refute".into()];
        scar.strength = 0.04;
        let id = scar.id.clone();
        let mut records = HashMap::from([(id.clone(), scar)]);
        guarded_reflect(&mut records, &TagTaxonomy::default());
        out.insert(
            "reflection_scar_guard".into(),
            json!({"standalone_survives_reopen":b.get(&r.id).is_some(),
            "guarded_reflect_survives":records.contains_key(&id)}),
        );
        b.close()?;
    }

    {
        let dir = tempfile::tempdir()?;
        let a = Aura::open(dir.path().to_str().unwrap())?;
        let text = "Cached demoted record hazel";
        let r = put(&a, text)?;
        let cached = || {
            a.recall_structured(
                text,
                Some(5),
                Some(0.0),
                Some(false),
                None,
                Some(&["audit"]),
            )
        };
        let before = cached()?.iter().any(|(_, v)| v.id == r.id);
        for _ in 0..14 {
            a.decay_by_route_state()?;
        }
        let after = cached()?.iter().any(|(_, v)| v.id == r.id);
        out.insert(
            "cached_demotion".into(),
            json!({"cached_before":before,
            "active_after_demotion":a.get(&r.id).is_some(),"cached_after_demotion":after,
            "uncached_after_demotion":query(&a,text,&r.id,0.0)?}),
        );
        a.close()?;
    }

    {
        let dir = tempfile::tempdir()?;
        let a = Aura::open(dir.path().to_str().unwrap())?;
        a.configure_maintenance(config(true, false));
        let r = a.store(
            "Pinned long term operational reference juniper",
            Some(Level::Identity),
            None,
            Some(true),
            None,
            None,
            None,
            Some(false),
            None,
            Some("audit"),
            None,
        )?;
        a.run_maintenance();
        let first_level = a.get(&r.id).map(|v| v.level.name().to_string());
        for _ in 1..14 {
            a.run_maintenance();
        }
        a.close()?;
        drop(a);
        let b = Aura::open(dir.path().to_str().unwrap())?;
        out.insert(
            "pinned_identity_lifecycle".into(),
            json!({
                "initial_level":r.level.name(),"level_after_first_maintenance":first_level,
                "exists_after_14_cycles_and_reopen":b.get(&r.id).is_some()
            }),
        );
        b.close()?;
    }

    let result = Value::Object(out);
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("reports/audit-2026-09-09/lifetime-probes.json");
    std::fs::create_dir_all(path.parent().unwrap())?;
    std::fs::write(&path, serde_json::to_string_pretty(&result)?)?;
    println!("{}", serde_json::to_string_pretty(&result)?);
    Ok(())
}
