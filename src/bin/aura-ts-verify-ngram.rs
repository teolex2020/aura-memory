use aura::ngram::NGramIndex;
use serde::Serialize;

#[derive(Serialize)]
struct NGramVerifier {
    hashes: Vec<(&'static str, u64)>,
    records: Vec<(&'static str, &'static str)>,
    query_text: &'static str,
    query: Vec<(f32, String)>,
    jaccard: Vec<(&'static str, &'static str, f32)>,
}

fn masked_xxh3(sample: &'static str) -> (&'static str, u64) {
    (
        sample,
        xxhash_rust::xxh3::xxh3_64(sample.as_bytes()) & 0x7FFFFFFF,
    )
}

fn main() -> anyhow::Result<()> {
    let records = vec![
        ("r1", "deploy staging safety checklist"),
        ("r2", "deploy staging rollback checklist"),
        ("r3", "banana unrelated note"),
        ("r4", "safety checklist review"),
    ];
    let query_text = "staging safety deploy";

    let mut index = NGramIndex::with_seed(None, None, 0);
    for (id, content) in &records {
        index.add(id, content);
    }

    let out = NGramVerifier {
        hashes: vec![
            masked_xxh3("a"),
            masked_xxh3("ab"),
            masked_xxh3("abc"),
            masked_xxh3("hel"),
            masked_xxh3("lo "),
            masked_xxh3("é"),
        ],
        records,
        query_text,
        query: index.query(query_text, 10),
        jaccard: vec![
            ("r1", "r2", index.jaccard("r1", "r2")),
            ("r1", "r3", index.jaccard("r1", "r3")),
            ("r1", "missing", index.jaccard("r1", "missing")),
        ],
    };

    println!("{}", serde_json::to_string(&out)?);
    Ok(())
}
