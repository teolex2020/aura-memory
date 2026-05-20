use aura::index::InvertedIndex;
use std::path::PathBuf;

fn main() -> anyhow::Result<()> {
    let out = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "typescript/test/fixtures/minimal_index".to_string());
    let out = PathBuf::from(out);
    std::fs::create_dir_all(&out)?;

    let index = InvertedIndex::new(&out);
    index.add("doc_a", &[2, 3, 10]);
    index.add("doc_b", &[3, 10]);
    index.add("doc_c", &[2, 99]);
    index.save()?;

    Ok(())
}

