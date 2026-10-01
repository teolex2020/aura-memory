//! A native embedder (the desktop app's local model) embeds stored records as
//! documents and recall queries as queries, and can index existing records.

use std::sync::{Arc, Mutex};

use aura::embedding::{EmbedKind, Embedder};
use aura::{Aura, Level};

/// Bag of hashed words; records which kind each call asked for.
struct Fake {
    calls: Mutex<Vec<EmbedKind>>,
}

impl Embedder for Fake {
    fn embed(&self, text: &str, kind: EmbedKind) -> Option<Vec<f32>> {
        self.calls.lock().unwrap().push(kind);
        let mut v = vec![0.0f32; 64];
        for word in text.to_lowercase().split(|c: char| !c.is_alphanumeric()) {
            if word.len() > 2 {
                let h = word
                    .bytes()
                    .fold(7u32, |a, b| a.wrapping_mul(31).wrapping_add(b as u32));
                v[(h % 64) as usize] += 1.0;
            }
        }
        let n = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-6);
        Some(v.into_iter().map(|x| x / n).collect())
    }
}

fn store(a: &Aura, text: &str) -> String {
    a.store(
        text,
        Some(Level::Domain),
        None,
        None,
        None,
        Some("recorded"),
        None,
        Some(false),
        None,
        None,
        None,
    )
    .unwrap()
    .id
}

#[test]
fn documents_and_queries_are_embedded_as_such() {
    let dir = tempfile::tempdir().unwrap();
    let a = Aura::open(dir.path().to_str().unwrap()).unwrap();
    let fake = Arc::new(Fake {
        calls: Mutex::new(Vec::new()),
    });
    a.set_embedder(Some(fake.clone()));
    store(&a, "My sister lives in Lviv near the opera house");
    store(&a, "The release pipeline runs on every tag");
    assert!(fake
        .calls
        .lock()
        .unwrap()
        .iter()
        .all(|k| *k == EmbedKind::Document));
    assert!(a.has_embeddings());
    let hits = a
        .recall_structured(
            "Where does my sister live?",
            Some(3),
            None,
            None,
            None,
            None,
        )
        .unwrap();
    assert!(hits[0].1.content.contains("Lviv"));
    assert_eq!(fake.calls.lock().unwrap().last(), Some(&EmbedKind::Query));
}

#[test]
fn existing_records_can_be_indexed_and_cleared() {
    let dir = tempfile::tempdir().unwrap();
    let a = Aura::open(dir.path().to_str().unwrap()).unwrap();
    // Stored before the model was switched on.
    store(&a, "I prefer trains to planes");
    store(&a, "Dentist appointment on Tuesday");
    assert_eq!(a.records_without_embedding().len(), 2);

    let fake = Arc::new(Fake {
        calls: Mutex::new(Vec::new()),
    });
    a.set_embedder(Some(fake));
    for (id, text) in a.records_without_embedding() {
        let v = a.embed_document(&text).unwrap();
        a.store_embedding(&id, v).unwrap();
    }
    assert!(a.records_without_embedding().is_empty());

    // Switching models: drop the vectors and start over.
    a.clear_embeddings().unwrap();
    assert!(!a.has_embeddings());
    assert_eq!(a.records_without_embedding().len(), 2);
    a.set_embedder(None);
    assert!(a.embed_document("anything").is_none());
}
