//! Regression test for lock-order deadlocks between concurrent recall,
//! store, update/delete and maintenance on one shared `Aura`.

use aura::{Aura, Level, Record};
use std::sync::Arc;
use std::time::{Duration, Instant};

fn store(aura: &Aura, text: &str) -> Option<Record> {
    aura.store(
        text,
        Some(Level::Working),
        Some(vec!["stress".into()]),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .ok()
}

#[test]
fn concurrent_recall_store_update_delete_and_maintenance_do_not_deadlock() {
    let dir = tempfile::tempdir().unwrap();
    let aura = Arc::new(Aura::open(dir.path().to_str().unwrap()).unwrap());
    for i in 0..30 {
        store(&aura, &format!("fact {i} about deployment"));
    }

    let stop = Instant::now() + Duration::from_secs(3);
    let workers: Vec<Box<dyn Fn(&Aura, usize) + Send>> = vec![
        Box::new(|a, _| {
            let _ = a.recall("deployment fact", Some(512), None, None, None, None);
        }),
        Box::new(|a, _| {
            let _ = a.recall_structured("deployment", Some(10), None, None, None, None);
        }),
        Box::new(|a, i| {
            store(a, &format!("note {i}"));
        }),
        Box::new(|a, i| {
            if let Some(rec) = store(a, &format!("mutable {i} deployment")) {
                let _ = a.update(
                    &rec.id,
                    Some("changed deployment"),
                    None,
                    None,
                    Some(0.5),
                    None,
                    None,
                );
                let _ = a.delete(&rec.id);
            }
        }),
        Box::new(|a, _| {
            let _ = a.run_maintenance();
        }),
    ];

    let handles: Vec<_> = workers
        .into_iter()
        .map(|work| {
            let aura = aura.clone();
            std::thread::spawn(move || {
                let mut i = 0;
                while Instant::now() < stop {
                    work(&aura, i);
                    i += 1;
                }
            })
        })
        .collect();

    // A deadlock leaves workers blocked forever; fail instead of hanging CI.
    let deadline = Instant::now() + Duration::from_secs(120);
    while handles.iter().any(|h| !h.is_finished()) {
        assert!(Instant::now() < deadline, "workers deadlocked");
        std::thread::sleep(Duration::from_millis(100));
    }
    for handle in handles {
        handle.join().unwrap();
    }
}
